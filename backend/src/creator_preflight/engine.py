"""Minimal Milestone 2 orchestration for deterministic media detectors."""

from pathlib import Path

from creator_preflight.config import DetectorConfig
from creator_preflight.detectors import (
    detect_black_segments,
    detect_freeze_segments,
    detect_long_silences,
    detect_missing_streams,
    inspect_audio_peak,
)
from creator_preflight.media import MediaInspector
from creator_preflight.models import AnomalyScanResult, Finding


class MediaAnomalyScanner:
    """Inspect once, run applicable detectors sequentially, and return findings."""

    def __init__(
        self,
        *,
        config: DetectorConfig | None = None,
        ffprobe_binary: str = "ffprobe",
        ffmpeg_binary: str = "ffmpeg",
        timeout_seconds: float = 60,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        self.config = config or DetectorConfig()
        self.ffprobe_binary = ffprobe_binary
        self.ffmpeg_binary = ffmpeg_binary
        self.timeout_seconds = timeout_seconds

    def scan(self, media_path: str | Path) -> AnomalyScanResult:
        media = MediaInspector(
            ffprobe_binary=self.ffprobe_binary,
            timeout_seconds=min(self.timeout_seconds, 15),
        ).inspect(media_path)
        findings: list[Finding] = detect_missing_streams(media, self.config.streams)
        if media.has_video:
            findings.extend(
                detect_black_segments(
                    media_path,
                    self.config.black,
                    ffmpeg_binary=self.ffmpeg_binary,
                    timeout_seconds=self.timeout_seconds,
                )
            )
            findings.extend(
                detect_freeze_segments(
                    media_path,
                    media,
                    self.config.freeze,
                    ffmpeg_binary=self.ffmpeg_binary,
                    timeout_seconds=self.timeout_seconds,
                )
            )
        if media.has_audio:
            findings.extend(
                detect_long_silences(
                    media_path,
                    media,
                    self.config.silence,
                    ffmpeg_binary=self.ffmpeg_binary,
                    timeout_seconds=self.timeout_seconds,
                )
            )
            findings.extend(
                inspect_audio_peak(
                    media_path,
                    media,
                    self.config.audio_peak,
                    ffmpeg_binary=self.ffmpeg_binary,
                    timeout_seconds=self.timeout_seconds,
                )
            )
        findings.sort(
            key=lambda finding: (
                finding.timestamp_start_seconds is None,
                finding.timestamp_start_seconds or 0,
                finding.code,
            )
        )
        return AnomalyScanResult(media=media, findings=findings)
