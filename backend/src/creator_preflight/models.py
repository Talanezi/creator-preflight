"""Shared typed contracts for media inspection and future findings."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class FindingSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class FindingStatus(str, Enum):
    READY = "READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    BLOCKED = "BLOCKED"


class Finding(BaseModel):
    """Stable normalized finding shape shared by later detectors."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    severity: FindingSeverity
    status: FindingStatus
    message: str = Field(min_length=1)
    source: str = Field(min_length=1)
    timestamp_start_seconds: float | None = Field(default=None, ge=0)
    timestamp_end_seconds: float | None = Field(default=None, ge=0)
    details: dict[str, JsonValue] | None = None
    suggestion: str | None = None

    @model_validator(mode="after")
    def validate_timestamp_range(self) -> "Finding":
        if (
            self.timestamp_end_seconds is not None
            and self.timestamp_start_seconds is None
        ):
            raise ValueError("timestamp_end_seconds requires timestamp_start_seconds")
        if (
            self.timestamp_start_seconds is not None
            and self.timestamp_end_seconds is not None
            and self.timestamp_end_seconds < self.timestamp_start_seconds
        ):
            raise ValueError(
                "timestamp_end_seconds cannot be earlier than timestamp_start_seconds"
            )
        return self


class MediaInspection(BaseModel):
    """Normalized technical metadata for one local media file."""

    model_config = ConfigDict(extra="forbid")

    duration_seconds: float | None = Field(default=None, ge=0)
    format_name: str | None = None
    file_size_bytes: int = Field(ge=0)

    has_video: bool
    video_stream_count: int = Field(ge=0)
    video_codec: str | None = None
    width: int | None = Field(default=None, ge=0)
    height: int | None = Field(default=None, ge=0)
    display_aspect_ratio: str | None = None
    frame_rate: float | None = Field(default=None, ge=0)
    pixel_format: str | None = None

    has_audio: bool
    audio_stream_count: int = Field(ge=0)
    audio_codec: str | None = None
    channel_count: int | None = Field(default=None, ge=0)
    sample_rate: int | None = Field(default=None, ge=0)


class AnomalyScanResult(BaseModel):
    """Milestone 2 media metadata and detector findings, without a verdict."""

    model_config = ConfigDict(extra="forbid")

    media: MediaInspection
    findings: list[Finding]


class MediaToolAvailability(BaseModel):
    """Availability of local media executables required by the project."""

    model_config = ConfigDict(extra="forbid")

    ffprobe_available: bool
    ffprobe_path: str | None
    ffmpeg_available: bool
    ffmpeg_path: str | None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody
