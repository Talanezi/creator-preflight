from pathlib import Path
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from tempfile import TemporaryDirectory as RealTemporaryDirectory

from creator_preflight.api import app
from creator_preflight import api as api_module
from creator_preflight.detectors import DetectorExecutionError

client = TestClient(app)


def _tiny_png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
        + chunk(b"IEND", b"")
    )


def test_api_upload_success(video_with_audio: Path) -> None:
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/media/inspect",
            files={"file": ("uploaded video.mp4", media_file, "video/mp4")},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["width"] == 160
    assert payload["height"] == 90
    assert payload["has_video"] is True
    assert payload["video_codec"] == "mpeg4"
    assert payload["has_audio"] is True
    assert payload["audio_codec"] == "aac"
    assert 0.9 <= payload["duration_seconds"] <= 1.2


def test_api_invalid_media_error_is_structured() -> None:
    response = client.post(
        "/api/v1/media/inspect",
        files={"file": ("invalid.mp4", b"not a media file", "video/mp4")},
    )

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "invalid_media",
            "message": "FFprobe could not parse the supplied media file.",
            "details": {"ffprobe_exit_code": 1},
        }
    }


def test_api_zero_byte_upload_error_is_structured() -> None:
    response = client.post(
        "/api/v1/media/inspect",
        files={"file": ("empty.mp4", b"", "video/mp4")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"


def test_unified_api_scan_returns_preflight_report(video_with_audio: Path) -> None:
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={"file": ("uploaded video.mp4", media_file, "video/mp4")},
            data={"title": "A title", "description": "A description"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.3"
    assert payload["ai_review"]["status"] == "disabled"
    assert payload["verdict"] == "BLOCKED"
    assert payload["media"]["width"] == 160
    assert payload["checks_run_count"] == len(payload["checks"])
    assert payload["critical_count"] == 2


def test_unified_api_anomaly_report_matches_real_frontend_contract(
    api_anomaly_video: Path,
) -> None:
    with api_anomaly_video.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={"file": ("api-known-anomalies.mp4", media_file, "video/mp4")},
            data={
                "title": "T" * 108,
                "description": "A real end-to-end Creator Preflight scan.",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "1.3"
    assert payload["ai_review"]["status"] == "disabled"
    assert payload["verdict"] == "NEEDS_REVIEW"
    assert payload["media"]["width"] == 1280
    assert payload["media"]["height"] == 720
    assert payload["checks_run_count"] == 14
    assert payload["passed_check_count"] == 9
    assert payload["warning_count"] == 5
    assert payload["critical_count"] == 0

    findings = {finding["code"]: finding for finding in payload["findings"]}
    assert set(findings) == {
        "VIDEO_BLACK_SEGMENT",
        "AUDIO_LONG_SILENCE",
        "VIDEO_FREEZE_SEGMENT",
        "AUDIO_PEAK_WARNING",
        "TITLE_LENGTH_RECOMMENDATION",
    }
    assert findings["VIDEO_BLACK_SEGMENT"]["timestamp_start_seconds"] == pytest.approx(2.0, abs=0.2)
    assert findings["VIDEO_BLACK_SEGMENT"]["timestamp_end_seconds"] == pytest.approx(5.0, abs=0.2)
    assert findings["AUDIO_LONG_SILENCE"]["timestamp_start_seconds"] == pytest.approx(3.0, abs=0.2)
    assert findings["AUDIO_LONG_SILENCE"]["timestamp_end_seconds"] == pytest.approx(6.0, abs=0.2)
    assert findings["VIDEO_FREEZE_SEGMENT"]["timestamp_start_seconds"] == pytest.approx(7.0, abs=0.2)
    assert findings["VIDEO_FREEZE_SEGMENT"]["timestamp_end_seconds"] == pytest.approx(10.0, abs=0.2)


def test_real_caption_upload_reaches_parser(video_with_audio: Path) -> None:
    captions = b"WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nHello\n"
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "captions": ("captions.vtt", captions, "text/vtt"),
            },
            data={"title": "Title", "description": "Description"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["caption_summary"]["source_format"] == "vtt"
    assert payload["caption_summary"]["cue_count"] == 1
    assert "captions.parse" in [check["check_id"] for check in payload["checks"]]
    assert "CAPTION_PARSE_ERROR" not in [finding["code"] for finding in payload["findings"]]


def test_malformed_caption_upload_returns_report_and_cleans_temp_files(
    video_with_audio: Path, monkeypatch
) -> None:
    created_paths: list[Path] = []

    def recording_temporary_directory(*args, **kwargs):
        temporary = RealTemporaryDirectory(*args, **kwargs)
        created_paths.append(Path(temporary.name))
        return temporary

    monkeypatch.setattr(api_module, "TemporaryDirectory", recording_temporary_directory)
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "captions": ("broken.srt", b"not caption syntax", "text/plain"),
            },
            data={"title": "Title", "description": "Description"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert "CAPTION_PARSE_ERROR" in [finding["code"] for finding in payload["findings"]]
    assert "CAPTION_EMPTY" not in [finding["code"] for finding in payload["findings"]]
    assert created_paths and all(not path.exists() for path in created_paths)


def test_caption_upload_size_limit_matches_scanner_report_behavior(
    video_with_audio: Path,
) -> None:
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "captions": ("too-large.srt", b"x" * 5_000_001, "text/plain"),
            },
            data={"title": "Title", "description": "Description"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["verdict"] == "BLOCKED"
    assert "CAPTION_PARSE_ERROR" in [finding["code"] for finding in payload["findings"]]
    parse_finding = next(
        finding
        for finding in payload["findings"]
        if finding["code"] == "CAPTION_PARSE_ERROR"
    )
    assert parse_finding["details"]["issues"][0]["message"] == (
        "Caption file exceeds the configured size limit."
    )


def test_api_accepts_png_thumbnail_and_cleans_temporary_file(
    video_with_audio: Path, monkeypatch
) -> None:
    created_paths: list[Path] = []

    def recording_temporary_directory(*args, **kwargs):
        temporary = RealTemporaryDirectory(*args, **kwargs)
        created_paths.append(Path(temporary.name))
        return temporary

    monkeypatch.setattr(api_module, "TemporaryDirectory", recording_temporary_directory)
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "thumbnail": ("thumbnail.png", _tiny_png(), "image/png"),
            },
            data={"title": "Title", "description": "Description"},
        )
    assert response.status_code == 200
    assert response.json()["promise_check"]["status"] == "disabled"
    assert created_paths and all(not path.exists() for path in created_paths)


def test_api_rejects_corrupt_thumbnail_cleanly(video_with_audio: Path) -> None:
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "thumbnail": ("thumbnail.png", b"not an image", "image/png"),
            },
            data={"title": "Title", "description": "Description"},
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "thumbnail_invalid"


def test_api_rejects_thumbnail_above_configured_limit(
    video_with_audio: Path, monkeypatch
) -> None:
    from creator_preflight.config import PreflightConfig

    config = PreflightConfig()
    config.ai_review.promise_check.maximum_thumbnail_file_size_bytes = 4
    monkeypatch.setattr(api_module, "_api_config", lambda: (config, "test config"))
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={
                "file": ("video.mp4", media_file, "video/mp4"),
                "thumbnail": ("thumbnail.png", _tiny_png(), "image/png"),
            },
            data={"title": "Title", "description": "Description"},
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "thumbnail_too_large"


def test_detector_timeout_uses_gateway_timeout_response(
    video_with_audio: Path, monkeypatch
) -> None:
    def timed_out(*args, **kwargs):
        del args, kwargs
        raise DetectorExecutionError(
            "detector_timeout",
            "The black-frame detector timed out.",
            details={"detector": "black", "timeout_seconds": 1},
        )

    monkeypatch.setattr(api_module.PreflightScanner, "scan", timed_out)
    with video_with_audio.open("rb") as media_file:
        response = client.post(
            "/api/v1/preflight/scan",
            files={"file": ("video.mp4", media_file, "video/mp4")},
            data={"title": "Title", "description": "Description"},
        )

    assert response.status_code == 504
    assert response.json() == {
        "error": {
            "code": "detector_timeout",
            "message": "The black-frame detector timed out.",
            "details": {"detector": "black", "timeout_seconds": 1},
        }
    }
