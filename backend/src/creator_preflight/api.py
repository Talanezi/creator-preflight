"""Minimal FastAPI adapter for local media inspection."""

from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse

from creator_preflight.media import MediaInspectionError, MediaInspector
from creator_preflight.models import ErrorResponse, MediaInspection

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


@app.post(
    "/api/v1/media/inspect",
    response_model=MediaInspection,
    responses={400: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
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
