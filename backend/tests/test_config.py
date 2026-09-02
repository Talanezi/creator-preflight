from pathlib import Path

import pytest
from pydantic import ValidationError

from creator_preflight.config import (
    BlackDetectorConfig,
    ConfigurationError,
    PreflightConfig,
    TitleRuleConfig,
    VideoRuleConfig,
    load_config,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_default_detector_configuration_loads() -> None:
    config = load_config(REPOSITORY_ROOT / "config" / "preflight.default.yml")

    assert config.detectors.black.min_duration_seconds == 2.0
    assert config.detectors.silence.noise_threshold_db == -50.0
    assert config.detectors.freeze.min_duration_seconds == 2.5
    assert config.detectors.audio_peak.warning_threshold_dbfs == -1.0
    assert config.rules.video.minimum_width == 1280
    assert config.rules.title.maximum_recommended_length == 100
    assert config.rules.description.validate_urls is True


def test_detector_configuration_rejects_invalid_threshold() -> None:
    with pytest.raises(ValidationError):
        BlackDetectorConfig(min_duration_seconds=0)


def test_yaml_configuration_error_is_structured(tmp_path: Path) -> None:
    config_path = tmp_path / "invalid.yml"
    config_path.write_text(
        "schema_version: 1\ndetectors:\n  silence:\n    noise_threshold_db: 4\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigurationError) as captured:
        load_config(config_path)

    assert captured.value.message == "Detector configuration is invalid."
    assert captured.value.errors is not None
    assert captured.value.errors[0]["location"] == "detectors.silence.noise_threshold_db"


def test_extended_configuration_is_valid() -> None:
    config = PreflightConfig.model_validate(
        {
            "schema_version": 1,
            "rules": {
                "profile_id": "demo",
                "video": {
                    "minimum_width": 1920,
                    "minimum_height": 1080,
                    "allowed_aspect_ratios": ["16:9"],
                },
                "description": {"required_phrases": ["Sources:"]},
                "captions": {"require": True},
            },
        }
    )

    assert config.rules.profile_id == "demo"
    assert config.rules.captions.require is True


@pytest.mark.parametrize("field", ["minimum_width", "minimum_height"])
def test_invalid_video_dimensions_are_rejected(field: str) -> None:
    with pytest.raises(ValidationError):
        VideoRuleConfig(**{field: 0})


def test_invalid_title_limit_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TitleRuleConfig(maximum_recommended_length=0)


@pytest.mark.parametrize("ratios", [[], ["16x9"], ["16:0"]])
def test_invalid_aspect_ratio_configuration_is_rejected(ratios: list[str]) -> None:
    with pytest.raises(ValidationError):
        VideoRuleConfig(allowed_aspect_ratios=ratios)
