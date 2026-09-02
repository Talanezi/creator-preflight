import json
from pathlib import Path

import pytest
import yaml

from creator_preflight.cli import main
from creator_preflight.config import PreflightConfig


@pytest.fixture
def ready_config_path(tmp_path: Path) -> Path:
    config = PreflightConfig()
    config.rules.video.minimum_width = 160
    config.rules.video.minimum_height = 90
    config.rules.video.allowed_aspect_ratios = ["16:9"]
    path = tmp_path / "ready.yml"
    path.write_text(yaml.safe_dump(config.model_dump(mode="json")), encoding="utf-8")
    return path


def _base_args(video: Path, config: Path) -> list[str]:
    return [
        "scan",
        str(video),
        "--title",
        "Valid title",
        "--description",
        "Valid description",
        "--config",
        str(config),
    ]


def test_cli_human_ready_scan(
    video_with_audio: Path, ready_config_path: Path, capsys
) -> None:
    exit_code = main(_base_args(video_with_audio, ready_config_path))
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "CREATOR PREFLIGHT" in captured.out
    assert "READY" in captured.out
    assert "PASS  14 checks" in captured.out
    assert captured.err == ""


def test_cli_json_mode_is_valid_json_only(
    video_with_audio: Path, ready_config_path: Path, capsys
) -> None:
    exit_code = main(
        [*_base_args(video_with_audio, ready_config_path), "--json"]
    )
    captured = capsys.readouterr()

    payload = json.loads(captured.out)
    assert exit_code == 0
    assert payload["verdict"] == "READY"
    assert captured.err == ""


def test_cli_findings_use_non_crash_exit_code(
    video_with_audio: Path, ready_config_path: Path, capsys
) -> None:
    args = _base_args(video_with_audio, ready_config_path)
    title_index = args.index("--title") + 1
    args[title_index] = ""
    exit_code = main(args)
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "BLOCKED" in captured.out
    assert "Missing required title" in captured.out
    assert captured.err == ""


def test_cli_invalid_input_exit_code(tmp_path: Path, capsys) -> None:
    exit_code = main(["scan", str(tmp_path / "missing.mp4"), "--json"])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert captured.out == ""
    assert "does not exist" in captured.err


def test_cli_invalid_configuration_exit_code(
    video_with_audio: Path, tmp_path: Path, capsys
) -> None:
    config_path = tmp_path / "invalid.yml"
    config_path.write_text(
        "schema_version: 1\nrules:\n  video:\n    minimum_width: 0\n",
        encoding="utf-8",
    )
    exit_code = main(
        ["scan", str(video_with_audio), "--config", str(config_path), "--json"]
    )
    captured = capsys.readouterr()

    assert exit_code == 2
    assert captured.out == ""
    assert "configuration is invalid" in captured.err


def test_cli_description_file(
    video_with_audio: Path, ready_config_path: Path, tmp_path: Path, capsys
) -> None:
    description_path = tmp_path / "description.txt"
    description_path.write_text("Description from file", encoding="utf-8")
    exit_code = main(
        [
            "scan",
            str(video_with_audio),
            "--title",
            "Title",
            "--description-file",
            str(description_path),
            "--config",
            str(ready_config_path),
        ]
    )
    capsys.readouterr()
    assert exit_code == 0


def test_cli_rejects_conflicting_description_inputs() -> None:
    with pytest.raises(SystemExit) as captured:
        main(
            [
                "scan",
                "video.mp4",
                "--description",
                "direct",
                "--description-file",
                "description.txt",
            ]
        )
    assert captured.value.code == 2


def test_cli_captions_uses_real_parser_in_json_mode(
    video_with_audio: Path, ready_config_path: Path, tmp_path: Path, capsys
) -> None:
    captions = tmp_path / "captions.srt"
    captions.write_text(
        "1\n00:00:00,000 --> 00:00:00,900\nCaptioned\n", encoding="utf-8"
    )
    exit_code = main(
        [
            *_base_args(video_with_audio, ready_config_path),
            "--captions",
            str(captions),
            "--json",
        ]
    )
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert payload["caption_summary"]["source_format"] == "srt"
    assert payload["caption_summary"]["cue_count"] == 1
    assert "captions.parse" in [check["check_id"] for check in payload["checks"]]


def test_cli_malformed_captions_appear_in_human_report(
    video_with_audio: Path, ready_config_path: Path, tmp_path: Path, capsys
) -> None:
    captions = tmp_path / "broken.vtt"
    captions.write_text("WEBVTT\n\nnot a cue\n", encoding="utf-8")
    exit_code = main(
        [
            *_base_args(video_with_audio, ready_config_path),
            "--captions",
            str(captions),
        ]
    )
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "NEEDS REVIEW" in captured.out
    assert "Caption file could not be parsed cleanly" in captured.out
    assert captured.err == ""
