"""Thin FastAPI adapters for inspection and unified preflight scanning."""

from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from creator_preflight.config import ConfigurationError, PreflightConfig
from creator_preflight.detectors import DetectorExecutionError
from creator_preflight.engine import PreflightScanner
from creator_preflight.media import MediaInspectionError, MediaInspector
from creator_preflight.models import (
    ErrorResponse,
    MediaInspection,
    PreflightReport,
    PublishingPackage,
)

app = FastAPI(title="Creator Preflight", version="0.1.0")


@app.exception_handler(MediaInspectionError)
async def media_inspection_error_handler(
    request: Request, exc: MediaInspectionError
) -> JSONResponse:
    del request
    status_code = {
        "file_not_found": 404,
        "media_tool_unavailable": 503,
        "ffprobe_execution_failed": 503,
        "ffprobe_timeout": 504,
    }.get(exc.code, 400)
    body = ErrorResponse(
        error={"code": exc.code, "message": exc.message, "details": exc.details}
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


@app.exception_handler(DetectorExecutionError)
async def detector_error_handler(
    request: Request, exc: DetectorExecutionError
) -> JSONResponse:
    del request
    status_code = {
        "media_tool_unavailable": 503,
        "detector_timeout": 504,
    }.get(exc.code, 500)
    body = ErrorResponse(
        error={"code": exc.code, "message": exc.message, "details": exc.details}
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(
    request: Request, exc: ConfigurationError
) -> JSONResponse:
    del request
    body = ErrorResponse(
        error={
            "code": "configuration_invalid",
            "message": exc.message,
            "details": {"errors": exc.errors} if exc.errors else None,
        }
    )
    return JSONResponse(status_code=500, content=body.model_dump(mode="json"))


@app.post(
    "/api/v1/media/inspect",
    response_model=MediaInspection,
    responses={
        400: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def inspect_uploaded_media(file: UploadFile = File(...)) -> MediaInspection:
    """Temporarily store and inspect one uploaded local media file."""

    try:
        with TemporaryDirectory(prefix="creator-preflight-") as temporary_directory:
            temporary_path = Path(temporary_directory) / "upload.media"
            with temporary_path.open("wb") as destination:
                while chunk := await file.read(1024 * 1024):
                    destination.write(chunk)
            return MediaInspector().inspect(temporary_path)
    finally:
        await file.close()


@app.post(
    "/api/v1/preflight/scan",
    response_model=PreflightReport,
    responses={
        400: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def scan_uploaded_package(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    description: str = Form(default=""),
    captions: UploadFile | None = File(default=None),
) -> PreflightReport:
    """Temporarily store an upload and run the shared unified scanner."""

    try:
        with TemporaryDirectory(prefix="creator-preflight-") as temporary_directory:
            config = PreflightConfig()
            temporary_path = Path(temporary_directory) / "upload.media"
            with temporary_path.open("wb") as destination:
                while chunk := await file.read(1024 * 1024):
                    destination.write(chunk)
            caption_path = None
            if captions is not None:
                caption_path = Path(temporary_directory) / "captions.upload"
                written = 0
                copy_limit = config.rules.captions.maximum_file_size_bytes + 1
                with caption_path.open("wb") as destination:
                    while chunk := await captions.read(64 * 1024):
                        remaining = copy_limit - written
                        if remaining <= 0:
                            break
                        destination.write(chunk[:remaining])
                        written += min(len(chunk), remaining)
                        if written >= copy_limit:
                            break
            package = PublishingPackage(
                title=title,
                description=description,
                captions_path=caption_path,
            )
            return PreflightScanner(
                config=config, configuration_source="typed defaults"
            ).scan(temporary_path, package)
    finally:
        await file.close()
        if captions is not None:
            await captions.close()
