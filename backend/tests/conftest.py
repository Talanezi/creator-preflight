"""Deterministic local media fixtures generated with FFmpeg."""

import shutil
import subprocess
from pathlib import Path

import pytest


def _ffmpeg_executable() -> str:
    executable = shutil.which("ffmpeg")
    if executable is None:
        pytest.fail(
            "FFmpeg is required to generate test fixtures but is not available on PATH."
        )
    return executable


def _generate_video(path: Path, *, with_audio: bool) -> Path:
    command = [
        _ffmpeg_executable(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=24:duration=1",
    ]
    if with_audio:
        command.extend(
            [
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:sample_rate=48000:duration=1",
            ]
        )
    command.extend(["-c:v", "mpeg4", "-pix_fmt", "yuv420p"])
    if with_audio:
        command.extend(["-c:a", "aac", "-shortest"])
    else:
        command.append("-an")
    command.append(str(path))

    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    if completed.returncode != 0:
        pytest.fail(
            "FFmpeg failed to generate deterministic test media: "
            f"exit code {completed.returncode}; {completed.stderr.strip()}"
        )
    return path


@pytest.fixture(scope="session")
def video_with_audio(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _generate_video(
        tmp_path_factory.mktemp("media") / "video with audio.mp4", with_audio=True
    )


@pytest.fixture(scope="session")
def video_without_audio(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _generate_video(
        tmp_path_factory.mktemp("media") / "video-without-audio.mp4",
        with_audio=False,
    )
