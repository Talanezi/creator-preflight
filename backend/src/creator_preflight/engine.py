"""Shared media anomaly and unified Creator Preflight scanning services."""

from pathlib import Path
from time import perf_counter

from creator_preflight.ai_review import AIReviewError, GeminiReviewSession, GeminiVideoReviewer
from creator_preflight.captions import inspect_caption_file, speech_gap_findings
from creator_preflight.claim_review import (
    ClaimReviewer,
    ClaimVerificationStatus,
    GeminiClaimReviewer,
    claim_review_findings,
)
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
    ClaimReviewStatus,
    ClaimReviewSummary,
    Finding,
    FindingSeverity,
    FindingStatus,
    PreflightReport,
    PromiseCheckStatus,
    PromiseCheckSummary,
    PublishingPackage,
    ViewerPassStatus,
    ViewerPassSummary,
)
from creator_preflight.promise_check import (
    GeminiPromiseReviewer,
    PromiseDelivery,
    PromiseReviewer,
    promise_findings,
)
from creator_preflight.rules import evaluate_package_rules
from creator_preflight.transcription import (
    SpeechTranscriber,
    TranscriptionUnavailableError,
    WhisperTranscriber,
)
from creator_preflight.thumbnails import inspect_thumbnail
from creator_preflight.viewer_pass import (
    GeminiViewerPassReviewer,
    ViewerPassOverallStatus,
    ViewerPassReviewer,
    viewer_pass_findings,
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
        promise_reviewer: PromiseReviewer | None = None,
        viewer_reviewer: ViewerPassReviewer | None = None,
        claim_reviewer: ClaimReviewer | None = None,
        ai_adapter: GeminiVideoReviewer | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        self.config = config or PreflightConfig()
        self.configuration_source = configuration_source
        self.ffprobe_binary = ffprobe_binary
        self.ffmpeg_binary = ffmpeg_binary
        self.timeout_seconds = timeout_seconds
        self.transcriber = transcriber or WhisperTranscriber()
        shared_adapter = ai_adapter or GeminiVideoReviewer()
        self.promise_reviewer = promise_reviewer or GeminiPromiseReviewer(shared_adapter)
        self.viewer_reviewer = (
            viewer_reviewer
            if viewer_reviewer is not None
            else None
            if promise_reviewer is not None
            else GeminiViewerPassReviewer(shared_adapter)
        )
        self.claim_reviewer = (
            claim_reviewer
            if claim_reviewer is not None
            else None
            if promise_reviewer is not None or viewer_reviewer is not None
            else GeminiClaimReviewer(shared_adapter)
        )
        self.ai_adapter = (
            shared_adapter
            if promise_reviewer is None and viewer_reviewer is None and claim_reviewer is None
            else None
        )

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
        thumbnail_info = None
        if package.thumbnail_path is not None:
            thumbnail_info = inspect_thumbnail(
                package.thumbnail_path,
                maximum_bytes=self.config.ai_review.promise_check.maximum_thumbnail_file_size_bytes,
            )
        ai_findings: list[Finding] = []
        ai_checks: list[CheckResult] = []
        ai_summary = AIReviewSummary(
            enabled=self.config.ai_review.enabled,
            provider=self.config.ai_review.provider,
            model=self.config.ai_review.model,
            status=AIReviewStatus.DISABLED,
        )
        promise_summary = PromiseCheckSummary(status=PromiseCheckStatus.DISABLED)
        viewer_summary = ViewerPassSummary(status=ViewerPassStatus.DISABLED)
        claim_summary = ClaimReviewSummary(status=ClaimReviewStatus.DISABLED)
        promise_enabled = (
            self.config.ai_review.enabled
            and self.config.ai_review.promise_check.enabled
        )
        viewer_enabled = (
            self.config.ai_review.enabled
            and self.config.ai_review.viewer_pass.enabled
            and self.viewer_reviewer is not None
        )
        claim_enabled = (
            self.config.ai_review.enabled
            and self.config.ai_review.claim_review.enabled
            and self.claim_reviewer is not None
        )
        if promise_enabled and not package.title.strip():
            promise_summary = PromiseCheckSummary(
                status=PromiseCheckStatus.NOT_EVALUABLE,
                explanation="Promise Check requires a non-empty title.",
            )

        promise_result = None
        viewer_result = None
        claim_result = None
        task_errors: dict[str, AIReviewError] = {}
        shared_provider_error: AIReviewError | None = None
        session: GeminiReviewSession | None = None
        needs_provider = claim_enabled or viewer_enabled or (promise_enabled and bool(package.title.strip()))
        if needs_provider and self.ai_adapter is not None:
            try:
                session = self.ai_adapter.open_session(media_path, self.config.ai_review)
                session.start()
            except AIReviewError as exc:
                shared_provider_error = exc
                if promise_enabled and package.title.strip():
                    task_errors["promise"] = exc
                if viewer_enabled:
                    task_errors["viewer"] = exc
                if claim_enabled:
                    task_errors["claims"] = exc

        if promise_enabled and package.title.strip() and "promise" not in task_errors:
            try:
                if session is not None:
                    promise_result = self.promise_reviewer.review_in_session(
                        session,
                        anomaly_result.media.duration_seconds,
                        title=package.title,
                        description=package.description,
                        thumbnail_path=package.thumbnail_path,
                        thumbnail_info=thumbnail_info,
                        config=self.config.ai_review,
                    )
                else:
                    promise_result = self.promise_reviewer.review(
                        media_path,
                        anomaly_result.media.duration_seconds,
                        title=package.title,
                        description=package.description,
                        thumbnail_path=package.thumbnail_path,
                        thumbnail_info=thumbnail_info,
                        config=self.config.ai_review,
                    )
            except AIReviewError as exc:
                task_errors["promise"] = exc

        if viewer_enabled and "viewer" not in task_errors:
            try:
                if session is not None:
                    viewer_result = self.viewer_reviewer.review_in_session(
                        session,
                        anomaly_result.media.duration_seconds,
                        config=self.config.ai_review,
                    )
                else:
                    viewer_result = self.viewer_reviewer.review(
                        media_path,
                        anomaly_result.media.duration_seconds,
                        config=self.config.ai_review,
                    )
            except AIReviewError as exc:
                task_errors["viewer"] = exc

        if claim_enabled and "claims" not in task_errors:
            try:
                if session is not None:
                    claim_result = self.claim_reviewer.review_in_session(
                        session,
                        anomaly_result.media.duration_seconds,
                        title=package.title,
                        description=package.description,
                        config=self.config.ai_review,
                    )
                else:
                    claim_result = self.claim_reviewer.review(
                        media_path,
                        anomaly_result.media.duration_seconds,
                        title=package.title,
                        description=package.description,
                        config=self.config.ai_review,
                    )
            except AIReviewError as exc:
                task_errors["claims"] = exc

        if session is not None:
            session.close()

        if promise_result is not None:
            promise_task_findings = promise_findings(
                promise_result.review,
                provider=promise_result.provider,
                model=promise_result.model,
                config=self.config.ai_review,
                thumbnail_supplied=package.thumbnail_path is not None,
            )
            ai_findings.extend(promise_task_findings)
            ai_checks.append(CheckResult(
                check_id="ai.promise",
                passed=not promise_task_findings,
                finding_codes=[finding.code for finding in promise_task_findings],
            ))
            promise_summary = _promise_summary(promise_result.review, promise_task_findings)
        elif "promise" in task_errors:
            exc = task_errors["promise"]
            finding = _ai_review_unavailable_finding(
                exc, provider=self.config.ai_review.provider, model=self.config.ai_review.model
            )
            ai_findings.append(finding)
            ai_checks.append(CheckResult(check_id="ai.promise", passed=False, finding_codes=[finding.code]))
            promise_summary = PromiseCheckSummary(status=PromiseCheckStatus.UNAVAILABLE, explanation=exc.message)

        if viewer_result is not None:
            viewer_findings = viewer_pass_findings(
                viewer_result.review,
                provider=viewer_result.provider,
                model=viewer_result.model,
                config=self.config.ai_review,
            )
            ai_findings.extend(viewer_findings)
            ai_checks.append(CheckResult(
                check_id="ai.viewer_pass",
                passed=not viewer_findings,
                finding_codes=[finding.code for finding in viewer_findings],
            ))
            viewer_summary = ViewerPassSummary(
                status=(
                    ViewerPassStatus.NOT_EVALUABLE
                    if viewer_result.review.overall_status is ViewerPassOverallStatus.NOT_EVALUABLE
                    else ViewerPassStatus.NEEDS_REVIEW
                    if viewer_findings
                    else ViewerPassStatus.CLEAN
                ),
                summary=viewer_result.review.summary,
                issue_count=len(viewer_findings),
            )
        elif "viewer" in task_errors:
            exc = task_errors["viewer"]
            if exc is shared_provider_error and any(
                finding.code == "AI_REVIEW_UNAVAILABLE" for finding in ai_findings
            ):
                viewer_failure_codes = ["AI_REVIEW_UNAVAILABLE"]
            else:
                finding = _viewer_unavailable_finding(
                    exc, provider=self.config.ai_review.provider, model=self.config.ai_review.model
                )
                ai_findings.append(finding)
                viewer_failure_codes = [finding.code]
            ai_checks.append(CheckResult(check_id="ai.viewer_pass", passed=False, finding_codes=viewer_failure_codes))
            viewer_summary = ViewerPassSummary(
                status=ViewerPassStatus.UNAVAILABLE,
                summary=exc.message,
            )

        if claim_result is not None:
            claim_findings = claim_review_findings(
                claim_result.review,
                provider=claim_result.provider,
                model=claim_result.model,
                config=self.config.ai_review,
            )
            ai_findings.extend(claim_findings)
            ai_checks.append(CheckResult(
                check_id="ai.claim_review",
                passed=not claim_findings,
                finding_codes=[finding.code for finding in claim_findings],
            ))
            supported = sum(item.status is ClaimVerificationStatus.SUPPORTED for item in claim_result.review.claims)
            conflicts = len(claim_findings)
            insufficient = sum(item.status is ClaimVerificationStatus.INSUFFICIENT_EVIDENCE for item in claim_result.review.claims)
            claim_summary = ClaimReviewSummary(
                status=(
                    ClaimReviewStatus.NO_CLAIMS if not claim_result.review.claims
                    else ClaimReviewStatus.NEEDS_REVIEW if conflicts
                    else ClaimReviewStatus.CLEAN
                ),
                claims_checked=len(claim_result.review.claims),
                supported_count=supported,
                conflict_count=conflicts,
                insufficient_evidence_count=insufficient,
                explanation=(
                    "No significant externally verifiable claims were selected."
                    if not claim_result.review.claims
                    else "Only sufficiently grounded possible conflicts become findings."
                ),
            )
        elif "claims" in task_errors:
            exc = task_errors["claims"]
            ai_checks.append(CheckResult(check_id="ai.claim_review", passed=False, finding_codes=[]))
            claim_summary = ClaimReviewSummary(
                status=ClaimReviewStatus.UNAVAILABLE,
                explanation=exc.message,
            )

        if self.config.ai_review.enabled:
            successes = int(promise_result is not None) + int(viewer_result is not None) + int(claim_result is not None)
            runtime_values = [
                result.total_seconds for result in (promise_result, viewer_result, claim_result) if result is not None
            ]
            first_error = next(iter(task_errors.values()), None)
            ai_summary = AIReviewSummary(
                enabled=True,
                provider=self.config.ai_review.provider,
                model=self.config.ai_review.model,
                status=(
                    AIReviewStatus.SUCCEEDED
                    if successes
                    else AIReviewStatus.NOT_RUN
                    if not needs_provider
                    else AIReviewStatus.UNAVAILABLE
                    if first_error and first_error.unavailable
                    else AIReviewStatus.FAILED
                ),
                observation_count=sum(
                    finding.source.startswith("ai.") and finding.code not in {"AI_REVIEW_UNAVAILABLE", "AI_VIEWER_PASS_UNAVAILABLE"}
                    for finding in ai_findings
                ),
                runtime_seconds=max(runtime_values) if runtime_values else None,
                cleanup_succeeded=(
                    session.cleanup_succeeded
                    if session is not None
                    else next(
                        (result.cleanup_succeeded for result in (promise_result, viewer_result, claim_result) if result is not None),
                        None,
                    )
                ),
                reason_code=first_error.code if first_error and not successes else None,
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
            promise_check=promise_summary,
            viewer_pass=viewer_summary,
            claim_review=claim_summary,
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


def _ai_review_unavailable_finding(
    exc: AIReviewError, *, provider: str, model: str
) -> Finding:
    return Finding(
        code="AI_REVIEW_UNAVAILABLE",
        severity=FindingSeverity.WARNING,
        status=FindingStatus.NEEDS_REVIEW,
        message=exc.message,
        source=f"ai.{provider}.promise",
        details={
            "category": "editorial",
            "title": "Promise Check unavailable",
            "reason_code": exc.code,
            "provider": provider,
            "model": model,
        },
        suggestion="Review the deterministic findings and retry AI review later if needed.",
    )


def _viewer_unavailable_finding(
    exc: AIReviewError, *, provider: str, model: str
) -> Finding:
    return Finding(
        code="AI_VIEWER_PASS_UNAVAILABLE",
        severity=FindingSeverity.WARNING,
        status=FindingStatus.NEEDS_REVIEW,
        message=exc.message,
        source=f"ai.{provider}.viewer",
        details={
            "category": "editorial",
            "title": "Final Viewer Pass unavailable",
            "reason_code": exc.code,
            "provider": provider,
            "model": model,
        },
        suggestion="Review the deterministic findings and retry the Viewer Pass later if needed.",
    )


def _promise_summary(review, findings: list[Finding]) -> PromiseCheckSummary:
    status = (
        PromiseCheckStatus.NOT_EVALUABLE
        if (
            review.overall_delivery is PromiseDelivery.NOT_EVALUABLE
            or (not findings and review.overall_delivery is not PromiseDelivery.ALIGNED)
        )
        else PromiseCheckStatus.NEEDS_REVIEW
        if findings
        else PromiseCheckStatus.ALIGNED
    )
    return PromiseCheckSummary(
        status=status,
        inferred_promise=review.inferred_promise,
        first_substantive_address_seconds=review.first_substantive_address_seconds,
        first_substantive_address_evidence=review.first_substantive_address_evidence,
        overall_delivery=review.overall_delivery.value,
        explanation=review.overall_delivery_explanation,
        confidence=review.confidence,
        thumbnail_alignment=(
            review.thumbnail_alignment.value if review.thumbnail_alignment is not None else None
        ),
    )
