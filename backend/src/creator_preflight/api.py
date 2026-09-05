"""Thin, bounded FastAPI adapters for inspection and unified scanning."""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory, mkdtemp
from threading import Lock

import anyio
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.background import BackgroundTask

from creator_preflight.config import ConfigurationError, PreflightConfig, load_config
from creator_preflight.detectors import DetectorExecutionError
from creator_preflight.engine import PreflightScanner
from creator_preflight.media import MediaInspectionError, MediaInspector, check_media_tools
from creator_preflight.models import (
    CapabilityReason,
    ErrorResponse,
    MediaInspection,
    PreflightCapabilities,
    PreflightReport,
    PublishingPackage,
    ReviewMode,
)
from creator_preflight.repair_models import RepairOperation, RepairOperationBatch
from creator_preflight.repairs import FFmpegRepairEngine, RepairError
from creator_preflight.thumbnails import ThumbnailValidationError, inspect_thumbnail

app = FastAPI(title="Creator Preflight", version="0.1.0")
_VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm"}


class UploadLimitError(Exception):
    def __init__(self, maximum_bytes: int):
        self.maximum_bytes = maximum_bytes
        self.message = f"Video exceeds the configured {maximum_bytes}-byte upload limit."


class ScanBusyError(Exception):
    message = "Creator Preflight is already running the maximum number of scans."


class RequestOriginError(Exception):
    message = "This browser origin is not allowed to start a local scan."


class ReviewModeError(Exception):
    message = "Review mode must be either 'full' or 'local'."


class _ProcessScanCapacity:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active = 0

    def acquire(self, limit: int) -> bool:
        with self._lock:
            if self._active >= limit:
                return False
            self._active += 1
            return True

    def release(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)


_scan_capacity = _ProcessScanCapacity()


def _error_response(status_code: int, code: str, message: str, details=None) -> JSONResponse:
    body = ErrorResponse(error={"code": code, "message": message, "details": details})
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


@app.exception_handler(MediaInspectionError)
async def media_inspection_error_handler(request: Request, exc: MediaInspectionError) -> JSONResponse:
    del request
    status_code = {
        "file_not_found": 404,
        "media_tool_unavailable": 503,
        "ffprobe_execution_failed": 503,
        "ffprobe_timeout": 504,
    }.get(exc.code, 400)
    return _error_response(status_code, exc.code, exc.message, exc.details)


@app.exception_handler(DetectorExecutionError)
async def detector_error_handler(request: Request, exc: DetectorExecutionError) -> JSONResponse:
    del request
    status_code = {"media_tool_unavailable": 503, "detector_timeout": 504}.get(exc.code, 500)
    return _error_response(status_code, exc.code, exc.message, exc.details)


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(request: Request, exc: ConfigurationError) -> JSONResponse:
    del request
    return _error_response(500, "configuration_invalid", exc.message, {"errors": exc.errors} if exc.errors else None)


@app.exception_handler(ThumbnailValidationError)
async def thumbnail_validation_error_handler(request: Request, exc: ThumbnailValidationError) -> JSONResponse:
    del request
    return _error_response(400, exc.code, exc.message)


@app.exception_handler(UploadLimitError)
async def upload_limit_error_handler(request: Request, exc: UploadLimitError) -> JSONResponse:
    del request
    return _error_response(413, "video_upload_too_large", exc.message, {"maximum_bytes": exc.maximum_bytes})


@app.exception_handler(ScanBusyError)
async def scan_busy_error_handler(request: Request, exc: ScanBusyError) -> JSONResponse:
    del request
    return _error_response(503, "scan_capacity_reached", exc.message)


@app.exception_handler(RequestOriginError)
async def origin_error_handler(request: Request, exc: RequestOriginError) -> JSONResponse:
    del request
    return _error_response(403, "request_origin_not_allowed", exc.message)


@app.exception_handler(ReviewModeError)
async def review_mode_error_handler(request: Request, exc: ReviewModeError) -> JSONResponse:
    del request
    return _error_response(400, "review_mode_invalid", exc.message)


@app.exception_handler(RepairError)
async def repair_error_handler(request: Request, exc: RepairError) -> JSONResponse:
    del request
    status_code = {
        "repair_encoder_unavailable": 503,
        "repair_render_unavailable": 503,
        "repair_render_timeout": 504,
    }.get(exc.code, 400)
    return _error_response(status_code, exc.code, exc.message, exc.details)


@app.get("/api/v1/capabilities", response_model=PreflightCapabilities)
async def capabilities() -> PreflightCapabilities:
    config, _ = _api_config()
    tools = check_media_tools()
    gemini_dependency = _module_available("google.genai")
    gemini_key = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    reasons: list[CapabilityReason] = []
    if not tools.ffprobe_available or not tools.ffmpeg_available:
        reasons.append(CapabilityReason(code="media_tools_unavailable", message="FFmpeg and FFprobe are required to scan local video."))
    if not gemini_dependency:
        reasons.append(CapabilityReason(code="gemini_dependency_unavailable", message="The optional Gemini backend dependency is not installed."))
    if not gemini_key:
        reasons.append(CapabilityReason(code="gemini_api_key_missing", message="The backend does not have a Gemini API key configured."))
    local_available = tools.ffprobe_available and tools.ffmpeg_available
    return PreflightCapabilities(
        ffprobe_available=tools.ffprobe_available,
        ffmpeg_available=tools.ffmpeg_available,
        gemini_dependency_available=gemini_dependency,
        gemini_api_key_configured=gemini_key,
        full_review_available=local_available and gemini_dependency and gemini_key,
        local_checks_available=local_available,
        transcription_dependency_available=_module_available("faster_whisper"),
        transcription_enabled=config.transcription.enabled,
        supported_review_modes=[ReviewMode.FULL, ReviewMode.LOCAL],
        maximum_video_upload_size_bytes=config.api.maximum_video_upload_size_bytes,
        full_review_unavailable_reasons=reasons,
    )


@app.post("/api/v1/media/inspect", response_model=MediaInspection)
async def inspect_uploaded_media(request: Request, file: UploadFile = File(...)) -> MediaInspection:
    config, _ = _api_config()
    _require_allowed_origin(request, config)
    try:
        with TemporaryDirectory(prefix="creator-preflight-") as temporary_directory:
            temporary_path = _media_temp_path(temporary_directory, file.filename)
            await _copy_upload(file, temporary_path, config.api.maximum_video_upload_size_bytes)
            return await anyio.to_thread.run_sync(MediaInspector().inspect, temporary_path)
    finally:
        await file.close()


@app.post("/api/v1/preflight/scan", response_model=PreflightReport)
async def scan_uploaded_package(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    description: str = Form(default=""),
    captions: UploadFile | None = File(default=None),
    thumbnail: UploadFile | None = File(default=None),
    review_mode: str = Form(default="local"),
) -> PreflightReport:
    """Temporarily store a package and run the shared scanner off the event loop."""

    base_config, configuration_source = _api_config()
    _require_allowed_origin(request, base_config)
    mode = _parse_review_mode(review_mode)
    config = _effective_web_config(base_config, mode)
    if not _scan_capacity.acquire(config.api.maximum_concurrent_scans):
        await file.close()
        if captions is not None:
            await captions.close()
        if thumbnail is not None:
            await thumbnail.close()
        raise ScanBusyError()
    try:
        with TemporaryDirectory(prefix="creator-preflight-") as temporary_directory:
            temporary_path = _media_temp_path(temporary_directory, file.filename)
            await _copy_upload(file, temporary_path, config.api.maximum_video_upload_size_bytes)
            caption_path = await _copy_optional_bounded(captions, Path(temporary_directory) / "captions.upload", config.rules.captions.maximum_file_size_bytes + 1)
            thumbnail_path = await _copy_optional_bounded(thumbnail, Path(temporary_directory) / "thumbnail.upload", config.ai_review.promise_check.maximum_thumbnail_file_size_bytes + 1)
            if thumbnail_path is not None:
                inspect_thumbnail(
                    thumbnail_path,
                    maximum_bytes=config.ai_review.promise_check.maximum_thumbnail_file_size_bytes,
                    maximum_width=config.ai_review.promise_check.maximum_thumbnail_width,
                    maximum_height=config.ai_review.promise_check.maximum_thumbnail_height,
                    maximum_pixels=config.ai_review.promise_check.maximum_thumbnail_pixels,
                    maximum_decompressed_bytes=config.ai_review.promise_check.maximum_thumbnail_decompressed_bytes,
                )
            package = PublishingPackage(title=title, description=description, captions_path=caption_path, thumbnail_path=thumbnail_path)
            scanner = PreflightScanner(config=config, configuration_source=configuration_source)
            return await anyio.to_thread.run_sync(partial(scanner.scan, temporary_path, package, review_mode=mode))
    finally:
        _scan_capacity.release()
        await file.close()
        if captions is not None:
            await captions.close()
        if thumbnail is not None:
            await thumbnail.close()


@app.post("/api/v1/repairs/preview", response_class=FileResponse)
async def preview_repair(
    request: Request,
    file: UploadFile = File(...),
    operation_json: str = Form(...),
) -> FileResponse:
    """Render one short before/after context clip for an allowlisted repair."""

    try:
        operation = RepairOperation.model_validate_json(operation_json)
    except (ValidationError, ValueError, TypeError) as exc:
        await file.close()
        raise RepairError(
            "repair_operation_invalid",
            "The proposed repair operation is invalid.",
        ) from exc
    return await _render_repair_response(
        request=request,
        file=file,
        operations=[operation],
        preview=True,
    )


@app.post("/api/v1/repairs/apply", response_class=FileResponse)
async def apply_repairs(
    request: Request,
    file: UploadFile = File(...),
    operations_json: str = Form(...),
) -> FileResponse:
    """Render one new MP4 containing all approved, non-overlapping repairs."""

    try:
        batch = RepairOperationBatch.model_validate_json(operations_json)
    except (ValidationError, ValueError, TypeError) as exc:
        await file.close()
        raise RepairError(
            "repair_operation_invalid",
            "The approved repair operations are invalid.",
        ) from exc
    return await _render_repair_response(
        request=request,
        file=file,
        operations=batch.operations,
        preview=False,
    )


async def _copy_upload(upload: UploadFile, destination: Path, maximum_bytes: int) -> None:
    written = 0
    with destination.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            written += len(chunk)
            if written > maximum_bytes:
                raise UploadLimitError(maximum_bytes)
            output.write(chunk)


async def _render_repair_response(
    *,
    request: Request,
    file: UploadFile,
    operations: list[RepairOperation],
    preview: bool,
) -> FileResponse:
    config, _ = _api_config()
    try:
        _require_allowed_origin(request, config)
    except RequestOriginError:
        await file.close()
        raise
    if not _scan_capacity.acquire(config.api.maximum_concurrent_scans):
        await file.close()
        raise ScanBusyError()
    temporary_directory = Path(mkdtemp(prefix="creator-preflight-repair-"))
    response_created = False
    try:
        source_path = _media_temp_path(str(temporary_directory), file.filename)
        await _copy_upload(
            file,
            source_path,
            config.api.maximum_video_upload_size_bytes,
        )
        media = await anyio.to_thread.run_sync(MediaInspector().inspect, source_path)
        output_path = temporary_directory / (
            "repair-preview.mp4" if preview else "repaired.mp4"
        )
        engine = FFmpegRepairEngine()
        if preview:
            result = await anyio.to_thread.run_sync(
                partial(
                    engine.render_preview,
                    source_path,
                    output_path,
                    operations[0],
                    media=media,
                )
            )
        else:
            result = await anyio.to_thread.run_sync(
                partial(
                    engine.render,
                    source_path,
                    output_path,
                    operations,
                    media=media,
                )
            )
        filename = _repair_download_filename(file.filename, preview=preview)
        response = FileResponse(
            result.output_path,
            media_type="video/mp4",
            filename=filename,
            background=BackgroundTask(shutil.rmtree, temporary_directory, True),
            headers={
                "X-Repair-Original-Duration": f"{result.original_duration_seconds:.6f}",
                "X-Repair-Output-Duration": f"{result.output_duration_seconds:.6f}",
                "X-Repair-Removed-Duration": f"{result.removed_duration_seconds:.6f}",
            },
        )
        response_created = True
        return response
    finally:
        _scan_capacity.release()
        await file.close()
        if not response_created:
            shutil.rmtree(temporary_directory, ignore_errors=True)


async def _copy_optional_bounded(upload: UploadFile | None, destination: Path, copy_limit: int) -> Path | None:
    if upload is None:
        return None
    written = 0
    with destination.open("wb") as output:
        while chunk := await upload.read(64 * 1024):
            remaining = copy_limit - written
            if remaining <= 0:
                break
            output.write(chunk[:remaining])
            written += min(len(chunk), remaining)
            if written >= copy_limit:
                break
    return destination


def _media_temp_path(directory: str, filename: str | None) -> Path:
    suffix = Path(filename or "").suffix.lower()
    return Path(directory) / f"upload{suffix if suffix in _VIDEO_SUFFIXES else '.media'}"


def _repair_download_filename(filename: str | None, *, preview: bool) -> str:
    stem = Path(filename or "video").stem
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-") or "video"
    suffix = "repair-preview" if preview else "repaired"
    return f"{safe_stem}.{suffix}.mp4"


def _parse_review_mode(value: str) -> ReviewMode:
    try:
        return ReviewMode(value.strip().lower())
    except ValueError as exc:
        raise ReviewModeError() from exc


def _effective_web_config(config: PreflightConfig, mode: ReviewMode) -> PreflightConfig:
    effective = config.model_copy(deep=True)
    if mode is ReviewMode.FULL:
        effective.ai_review.enabled = True
        effective.ai_review.promise_check.enabled = True
        effective.ai_review.viewer_pass.enabled = True
        effective.ai_review.claim_review.enabled = True
    else:
        effective.ai_review.enabled = False
    return effective


def _require_allowed_origin(request: Request, config: PreflightConfig) -> None:
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in config.api.allowed_browser_origins:
        raise RequestOriginError()


def _module_available(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def _api_config() -> tuple[PreflightConfig, str]:
    config_path = os.environ.get("CREATOR_PREFLIGHT_CONFIG", "").strip()
    return ((load_config(config_path), config_path) if config_path else (PreflightConfig(), "typed defaults"))
