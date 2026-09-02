from pathlib import Path

from fastapi.testclient import TestClient

from creator_preflight.api import app

client = TestClient(app)


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
    assert payload["schema_version"] == "1.0"
    assert payload["verdict"] == "BLOCKED"
    assert payload["media"]["width"] == 160
    assert payload["checks_run_count"] == len(payload["checks"])
    assert payload["critical_count"] == 2
