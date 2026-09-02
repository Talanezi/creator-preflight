from pathlib import Path

import pytest
from pydantic import ValidationError

from creator_preflight.config import (
    BlackDetectorConfig,
    ConfigurationError,
    load_config,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_default_detector_configuration_loads() -> None:
    config = load_config(REPOSITORY_ROOT / "config" / "preflight.default.yml")

    assert config.detectors.black.min_duration_seconds == 2.0
    assert config.detectors.silence.noise_threshold_db == -50.0
    assert config.detectors.freeze.min_duration_seconds == 2.5
    assert config.detectors.audio_peak.warning_threshold_dbfs == -1.0


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
