"""Shared media anomaly and unified Creator Preflight scanning services."""

from pathlib import Path
from time import perf_counter

from creator_preflight.ai_review import (
    AIObservation,
    AIReviewError,
    GeminiVideoReviewer,
    VideoReviewer,
)
from creator_preflight.captions import inspect_caption_file, speech_gap_findings
from creator_preflight.config import DetectorConfig, PreflightConfig
from creator_preflight.detectors import (
    detect_black_segments,
    detect_freeze_segments,
    detect_long_silences,
    detect_missing_streams,
    inspect_audio_peak,
)
from creator_preflight.media import MediaInspector
from creator_preflight.models import (
    AIReviewStatus,
    AIReviewSummary,
    AnomalyScanResult,
    CheckResult,
    Finding,
    FindingSeverity,
    FindingStatus,
    PreflightReport,
    PublishingPackage,
)
from creator_preflight.rules import evaluate_package_rules
from creator_preflight.transcription import (
    SpeechTranscriber,
    TranscriptionUnavailableError,
    WhisperTranscriber,
)


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


class PreflightScanner:
    """Run one complete, deterministic preflight scan for every adapter."""

    def __init__(
        self,
        *,
        config: PreflightConfig | None = None,
        configuration_source: str | None = None,
        ffprobe_binary: str = "ffprobe",
        ffmpeg_binary: str = "ffmpeg",
        timeout_seconds: float = 60,
        transcriber: SpeechTranscriber | None = None,
        ai_reviewer: VideoReviewer | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        self.config = config or PreflightConfig()
        self.configuration_source = configuration_source
        self.ffprobe_binary = ffprobe_binary
        self.ffmpeg_binary = ffmpeg_binary
        self.timeout_seconds = timeout_seconds
        self.transcriber = transcriber or WhisperTranscriber()
        self.ai_reviewer = ai_reviewer or GeminiVideoReviewer()

    def scan(
        self, media_path: str | Path, package: PublishingPackage
    ) -> PreflightReport:
        started_at = perf_counter()
        detector_config = self.config.detectors.model_copy(deep=True)
        detector_config.streams.expect_video = self.config.rules.video.require_video
        detector_config.streams.expect_audio = self.config.rules.video.require_audio

        anomaly_result = MediaAnomalyScanner(
            config=detector_config,
            ffprobe_binary=self.ffprobe_binary,
            ffmpeg_binary=self.ffmpeg_binary,
            timeout_seconds=self.timeout_seconds,
        ).scan(media_path)
        package_result = evaluate_package_rules(
            package, anomaly_result.media, self.config.rules
        )
        caption_findings: list[Finding] = []
        caption_checks: list[CheckResult] = []
        caption_summary = None
        caption_cues = []
        if package.captions_path is not None:
            caption_result = inspect_caption_file(
                package.captions_path,
                media_duration_seconds=anomaly_result.media.duration_seconds,
                config=self.config.rules.captions,
            )
            caption_findings.extend(caption_result.findings)
            caption_checks.extend(caption_result.checks)
            caption_summary = caption_result.summary
            caption_cues = caption_result.cues

        if self.config.transcription.enabled and anomaly_result.media.has_audio:
            try:
                speech_segments = self.transcriber.transcribe(
                    media_path, self.config.transcription
                )
                gap_findings = speech_gap_findings(
                    speech_segments, caption_cues, self.config.transcription
                )
                caption_findings.extend(gap_findings)
                caption_checks.append(
                    CheckResult(
                        check_id="captions.speech_coverage",
                        passed=not gap_findings,
                        finding_codes=[finding.code for finding in gap_findings],
                    )
                )
            except TranscriptionUnavailableError as exc:
                unavailable = _transcription_unavailable_finding(exc)
                caption_findings.append(unavailable)
                caption_checks.append(
                    CheckResult(
                        check_id="captions.speech_coverage",
                        passed=False,
                        finding_codes=[unavailable.code],
                    )
                )
        ai_findings: list[Finding] = []
        ai_checks: list[CheckResult] = []
        ai_summary = AIReviewSummary(
            enabled=self.config.ai_review.enabled,
            provider=self.config.ai_review.provider,
            model=self.config.ai_review.model,
            status=AIReviewStatus.DISABLED,
        )
        if self.config.ai_review.enabled:
            try:
                ai_result = self.ai_reviewer.review(
                    media_path,
                    anomaly_result.media.duration_seconds,
                    self.config.ai_review,
                )
                ai_findings = [
                    _ai_observation_finding(
                        observation,
                        provider=ai_result.provider,
                        model=ai_result.model,
                    )
                    for observation in ai_result.observations
                ]
                ai_checks.append(
                    CheckResult(
                        check_id="ai.review",
                        passed=not ai_findings,
                        finding_codes=[finding.code for finding in ai_findings],
                    )
                )
                ai_summary = AIReviewSummary(
                    enabled=True,
                    provider=ai_result.provider,
                    model=ai_result.model,
                    status=AIReviewStatus.SUCCEEDED,
                    observation_count=len(ai_result.observations),
                    runtime_seconds=ai_result.total_seconds,
                    cleanup_succeeded=ai_result.cleanup_succeeded,
                )
            except AIReviewError as exc:
                unavailable = _ai_review_unavailable_finding(
                    exc,
                    provider=self.config.ai_review.provider,
                    model=self.config.ai_review.model,
                )
                ai_findings.append(unavailable)
                ai_checks.append(
                    CheckResult(
                        check_id="ai.review",
                        passed=False,
                        finding_codes=[unavailable.code],
                    )
                )
                ai_summary = AIReviewSummary(
                    enabled=True,
                    provider=self.config.ai_review.provider,
                    model=self.config.ai_review.model,
                    status=(
                        AIReviewStatus.UNAVAILABLE
                        if exc.unavailable
                        else AIReviewStatus.FAILED
                    ),
                    reason_code=exc.code,
                )
        findings = reconcile_findings(
            [
                *anomaly_result.findings,
                *package_result.findings,
                *caption_findings,
                *ai_findings,
            ]
        )
        findings.sort(key=finding_sort_key)

        checks = [
            *_technical_check_results(
                anomaly_result.media, findings, detector_config
            ),
            *package_result.checks,
            *caption_checks,
            *ai_checks,
        ]
        passed_count = sum(check.passed for check in checks)
        warning_count = sum(
            finding.status is FindingStatus.NEEDS_REVIEW for finding in findings
        )
        critical_count = sum(
            finding.status is FindingStatus.BLOCKED for finding in findings
        )
        verdict = (
            FindingStatus.BLOCKED
            if critical_count
            else FindingStatus.NEEDS_REVIEW
            if warning_count
            else FindingStatus.READY
        )
        return PreflightReport(
            verdict=verdict,
            media=anomaly_result.media,
            findings=findings,
            checks=checks,
            checks_run_count=len(checks),
            passed_check_count=passed_count,
            warning_count=warning_count,
            critical_count=critical_count,
            configuration_profile=(
                package.profile_id or self.config.rules.profile_id
            ),
            configuration_source=self.configuration_source,
            caption_summary=caption_summary,
            ai_review=ai_summary,
            scan_duration_seconds=perf_counter() - started_at,
        )


def reconcile_findings(findings: list[Finding]) -> list[Finding]:
    """Suppress only explicit duplicate streams and black-contained freezes."""

    black_intervals = [
        (finding.timestamp_start_seconds, finding.timestamp_end_seconds)
        for finding in findings
        if finding.code == "VIDEO_BLACK_SEGMENT"
        and finding.timestamp_start_seconds is not None
        and finding.timestamp_end_seconds is not None
    ]
    reconciled: list[Finding] = []
    seen_missing_stream_codes: set[str] = set()
    for finding in findings:
        if finding.code in {"VIDEO_STREAM_MISSING", "AUDIO_STREAM_MISSING"}:
            if finding.code in seen_missing_stream_codes:
                continue
            seen_missing_stream_codes.add(finding.code)
        if finding.code == "VIDEO_FREEZE_SEGMENT" and _mostly_inside_any_interval(
            finding, black_intervals
        ):
            continue
        reconciled.append(finding)
    return reconciled


def finding_sort_key(finding: Finding) -> tuple[int, int, float, str, str]:
    """Critical before warning; within severity, timestamped before global."""

    severity_rank = {
        FindingStatus.BLOCKED: 0,
        FindingStatus.NEEDS_REVIEW: 1,
        FindingStatus.READY: 2,
    }[finding.status]
    timestamp_group = 0 if finding.timestamp_start_seconds is not None else 1
    return (
        severity_rank,
        timestamp_group,
        finding.timestamp_start_seconds or 0.0,
        finding.code,
        finding.message,
    )


def _mostly_inside_any_interval(
    finding: Finding,
    intervals: list[tuple[float | None, float | None]],
    *,
    required_overlap: float = 0.90,
) -> bool:
    start = finding.timestamp_start_seconds
    end = finding.timestamp_end_seconds
    if start is None or end is None or end <= start:
        return False
    duration = end - start
    for container_start, container_end in intervals:
        if container_start is None or container_end is None:
            continue
        overlap = max(0.0, min(end, container_end) - max(start, container_start))
        if overlap / duration >= required_overlap:
            return True
    return False


def _technical_check_results(
    media,
    findings: list[Finding],
    config: DetectorConfig,
) -> list[CheckResult]:
    checks: list[tuple[str, set[str]]] = []
    if config.streams.expect_video:
        checks.append(("media.video_stream", {"VIDEO_STREAM_MISSING"}))
    if config.streams.expect_audio:
        checks.append(("media.audio_stream", {"AUDIO_STREAM_MISSING"}))
    if media.has_video:
        checks.extend(
            [
                ("detector.black", {"VIDEO_BLACK_SEGMENT"}),
                ("detector.freeze", {"VIDEO_FREEZE_SEGMENT"}),
            ]
        )
    if media.has_audio:
        checks.extend(
            [
                ("detector.silence", {"AUDIO_LONG_SILENCE"}),
                ("detector.audio_peak", {"AUDIO_PEAK_WARNING"}),
            ]
        )
    results: list[CheckResult] = []
    for check_id, codes in checks:
        matching_codes = [
            finding.code for finding in findings if finding.code in codes
        ]
        results.append(
            CheckResult(
                check_id=check_id,
                passed=not matching_codes,
                finding_codes=matching_codes,
            )
        )
    return results


def _transcription_unavailable_finding(
    exc: TranscriptionUnavailableError,
) -> Finding:
    return Finding(
        code="CAPTION_TRANSCRIPTION_UNAVAILABLE",
        severity=FindingSeverity.WARNING,
        status=FindingStatus.NEEDS_REVIEW,
        message=exc.message,
        source="captions.speech",
        details={
            "category": "captions",
            "title": "Optional speech recognition unavailable",
            "reason_code": exc.code,
        },
        suggestion="Disable transcription or install/configure a local faster-whisper model, then scan again.",
    )


def _ai_observation_finding(
    observation: AIObservation, *, provider: str, model: str
) -> Finding:
    return Finding(
        code=f"AI_REVIEW_{observation.observation_type.value.upper()}",
        severity=FindingSeverity.WARNING,
        status=FindingStatus.NEEDS_REVIEW,
        message=observation.explanation,
        source=f"ai.{provider}",
        timestamp_start_seconds=observation.start_seconds,
        timestamp_end_seconds=observation.end_seconds,
        details={
            "category": "ai",
            "title": observation.summary,
            "observation_type": observation.observation_type.value,
            "confidence": observation.confidence,
            "evidence": observation.evidence,
            "provider": provider,
            "model": model,
        },
        suggestion=observation.suggestion,
    )


def _ai_review_unavailable_finding(
    exc: AIReviewError, *, provider: str, model: str
) -> Finding:
    return Finding(
        code="AI_REVIEW_UNAVAILABLE",
        severity=FindingSeverity.WARNING,
        status=FindingStatus.NEEDS_REVIEW,
        message=exc.message,
        source=f"ai.{provider}",
        details={
            "category": "ai",
            "title": "Optional AI review unavailable",
            "reason_code": exc.code,
            "provider": provider,
            "model": model,
        },
        suggestion="Review the deterministic findings and retry AI review later if needed.",
    )
