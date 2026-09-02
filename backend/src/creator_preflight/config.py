"""Typed configuration for Milestone 2 deterministic media detectors."""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

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
    """Global decoded audio peak warning threshold in dBFS."""

    model_config = ConfigDict(extra="forbid")

    warning_threshold_dbfs: float = Field(default=-1.0, ge=-120, le=0)


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


class PreflightConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    detectors: DetectorConfig = Field(default_factory=DetectorConfig)


class ConfigurationError(Exception):
    """Configuration failure with a concise application-level explanation."""

    def __init__(self, message: str, *, errors: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors


def load_config(path: str | Path) -> PreflightConfig:
    """Load and validate detector configuration from YAML."""

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
            "Detector configuration is invalid.", errors=errors
        ) from exc
