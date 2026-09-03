"""Typed configuration for Milestone 2 deterministic media detectors."""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)

from creator_preflight.models import FindingSeverity


class BlackDetectorConfig(BaseModel):
    """Blackdetect thresholds; durations use seconds and ratios use 0..1."""

    model_config = ConfigDict(extra="forbid")

    min_duration_seconds: float = Field(default=2.0, gt=0, le=3600)
    pixel_black_threshold: float = Field(default=0.10, gt=0, le=1)
    picture_black_ratio: float = Field(default=0.98, gt=0, le=1)


class SilenceDetectorConfig(BaseModel):
    """Silencedetect thresholds in seconds and decibels relative to full scale."""

    model_config = ConfigDict(extra="forbid")

    min_duration_seconds: float = Field(default=2.0, gt=0, le=3600)
    noise_threshold_db: float = Field(default=-50.0, ge=-120, le=0)


class FreezeDetectorConfig(BaseModel):
    """Freezedetect thresholds in seconds and frame-difference decibels."""

    model_config = ConfigDict(extra="forbid")

    min_duration_seconds: float = Field(default=2.5, gt=0, le=3600)
    noise_threshold_db: float = Field(default=-60.0, ge=-120, le=0)


class AudioPeakDetectorConfig(BaseModel):
    """Global decoded near-full-scale density thresholds."""

    model_config = ConfigDict(extra="forbid")

    warning_threshold_dbfs: float = Field(default=-1.0, ge=-120, le=0)
    minimum_near_full_scale_sample_fraction: float = Field(
        default=0.05, gt=0, le=1
    )


class StreamExpectationConfig(BaseModel):
    """Expected streams and finding severities for creator-video inputs."""

    model_config = ConfigDict(extra="forbid")

    expect_video: bool = True
    expect_audio: bool = True
    missing_video_severity: FindingSeverity = FindingSeverity.ERROR
    missing_audio_severity: FindingSeverity = FindingSeverity.WARNING


class DetectorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    black: BlackDetectorConfig = Field(default_factory=BlackDetectorConfig)
    silence: SilenceDetectorConfig = Field(default_factory=SilenceDetectorConfig)
    freeze: FreezeDetectorConfig = Field(default_factory=FreezeDetectorConfig)
    audio_peak: AudioPeakDetectorConfig = Field(default_factory=AudioPeakDetectorConfig)
    streams: StreamExpectationConfig = Field(default_factory=StreamExpectationConfig)


def _parse_aspect_ratio(value: str) -> float:
    parts = value.split(":")
    if len(parts) != 2:
        raise ValueError("aspect ratio must use WIDTH:HEIGHT format")
    try:
        width, height = (float(part) for part in parts)
    except ValueError as exc:
        raise ValueError("aspect ratio components must be numeric") from exc
    if width <= 0 or height <= 0:
        raise ValueError("aspect ratio components must be greater than zero")
    return width / height


class VideoRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minimum_width: int = Field(default=1280, gt=0)
    minimum_height: int = Field(default=720, gt=0)
    allowed_aspect_ratios: list[str] = Field(
        default_factory=lambda: ["16:9", "9:16", "1:1"], min_length=1
    )
    aspect_ratio_tolerance: float = Field(default=0.02, ge=0, le=0.25)
    require_video: bool = True
    require_audio: bool = True

    @field_validator("allowed_aspect_ratios")
    @classmethod
    def validate_aspect_ratios(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            normalized = value.strip()
            _parse_aspect_ratio(normalized)
            if normalized not in cleaned:
                cleaned.append(normalized)
        if not cleaned:
            raise ValueError("at least one allowed aspect ratio is required")
        return cleaned


class TitleRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require: bool = True
    maximum_recommended_length: int = Field(default=100, gt=0, le=10000)


class DescriptionRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require: bool = True
    required_phrases: list[str] = Field(default_factory=list)
    validate_urls: bool = True

    @field_validator("required_phrases")
    @classmethod
    def validate_required_phrases(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("required phrases cannot be empty")
        return list(dict.fromkeys(cleaned))


class ChapterRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require: bool = False
    require_first_at_zero: bool = True


class CaptionRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require: bool = False
    maximum_file_size_bytes: int = Field(default=5_000_000, gt=0, le=50_000_000)
    maximum_uncovered_gap_seconds: float = Field(default=10.0, gt=0, le=3600)
    overlap_warning_threshold_seconds: float = Field(default=0.5, gt=0, le=3600)
    warn_on_empty_cues: bool = True


class TranscriptionConfig(BaseModel):
    """Opt-in local faster-whisper settings; disabled and network-free by default."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    model: str = Field(default="tiny.en", min_length=1, max_length=200)
    device: Literal["cpu", "cuda", "auto"] = "cpu"
    compute_type: str = Field(default="int8", min_length=1, max_length=50)
    local_files_only: bool = True
    speech_gap_minimum_seconds: float = Field(default=2.0, gt=0, le=3600)
    boundary_tolerance_seconds: float = Field(default=0.3, ge=0, le=5)
    adjacent_gap_merge_seconds: float = Field(default=0.5, ge=0, le=10)


class AIReviewConfig(BaseModel):
    """Opt-in server-side Gemini video review settings."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    provider: Literal["gemini"] = "gemini"
    model: str = Field(default="gemini-3.7-flash", min_length=1, max_length=100)
    timeout_seconds: float = Field(default=180.0, gt=0, le=900)
    maximum_observations: int = Field(default=5, ge=1, le=10)
    timestamp_tolerance_seconds: float = Field(default=1.0, ge=0, le=10)
    promise_check: "PromiseCheckConfig" = Field(default_factory=lambda: PromiseCheckConfig())


class PromiseCheckConfig(BaseModel):
    """Conservative application policy applied to validated Promise output."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    delay_warning_seconds: float = Field(default=20.0, gt=0, le=600)
    minimum_issue_confidence: float = Field(default=0.70, ge=0, le=1)
    maximum_thumbnail_file_size_bytes: int = Field(
        default=5_000_000, gt=0, le=20_000_000
    )


class CreatorRuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile_id: str = Field(default="default", min_length=1)
    video: VideoRuleConfig = Field(default_factory=VideoRuleConfig)
    title: TitleRuleConfig = Field(default_factory=TitleRuleConfig)
    description: DescriptionRuleConfig = Field(default_factory=DescriptionRuleConfig)
    chapters: ChapterRuleConfig = Field(default_factory=ChapterRuleConfig)
    captions: CaptionRuleConfig = Field(default_factory=CaptionRuleConfig)


class PreflightConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    detectors: DetectorConfig = Field(default_factory=DetectorConfig)
    rules: CreatorRuleConfig = Field(default_factory=CreatorRuleConfig)
    transcription: TranscriptionConfig = Field(default_factory=TranscriptionConfig)
    ai_review: AIReviewConfig = Field(default_factory=AIReviewConfig)


class ConfigurationError(Exception):
    """Configuration failure with a concise application-level explanation."""

    def __init__(self, message: str, *, errors: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors


def load_config(path: str | Path) -> PreflightConfig:
    """Load and validate detector and creator-rule configuration from YAML."""

    config_path = Path(path)
    try:
        raw_config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigurationError(
            f"Could not read configuration file: {config_path}"
        ) from exc
    except yaml.YAMLError as exc:
        raise ConfigurationError("Configuration file is not valid YAML.") from exc

    if not isinstance(raw_config, dict):
        raise ConfigurationError("Configuration root must be a YAML mapping.")
    try:
        return PreflightConfig.model_validate(raw_config)
    except ValidationError as exc:
        errors = [
            {
                "location": ".".join(str(part) for part in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
            for error in exc.errors()
        ]
        raise ConfigurationError(
            "Creator Preflight configuration is invalid.", errors=errors
        ) from exc


def aspect_ratio_value(value: str) -> float:
    """Return the numeric value of an already validated WIDTH:HEIGHT ratio."""

    return _parse_aspect_ratio(value)
