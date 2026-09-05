export type FindingSeverity = "info" | "warning" | "error";
export type FindingStatus = "READY" | "NEEDS_REVIEW" | "BLOCKED";
export type ReviewMode = "full" | "local";
export type ScanCompleteness = "COMPLETE" | "PARTIAL" | "FAILED";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Finding {
  code: string;
  severity: FindingSeverity;
  status: FindingStatus;
  message: string;
  source: string;
  timestamp_start_seconds: number | null;
  timestamp_end_seconds: number | null;
  details: Record<string, JsonValue> | null;
  suggestion: string | null;
}

export interface MediaInspection {
  duration_seconds: number | null;
  format_name: string | null;
  file_size_bytes: number;
  has_video: boolean;
  video_stream_count: number;
  video_codec: string | null;
  width: number | null;
  height: number | null;
  display_aspect_ratio: string | null;
  frame_rate: number | null;
  pixel_format: string | null;
  has_audio: boolean;
  audio_stream_count: number;
  audio_codec: string | null;
  channel_count: number | null;
  sample_rate: number | null;
}

export interface CheckResult {
  check_id: string;
  passed: boolean;
  finding_codes: string[];
}

export interface CaptionSummary {
  source_format: string;
  cue_count: number;
  first_caption_seconds: number | null;
  last_caption_seconds: number | null;
  covered_duration_seconds: number;
  timeline_coverage_percent: number | null;
}

export type AIReviewStatus = "disabled" | "not_run" | "succeeded" | "unavailable" | "failed";

export interface AIReviewSummary {
  enabled: boolean;
  provider: string;
  model: string;
  status: AIReviewStatus;
  observation_count: number;
  runtime_seconds: number | null;
  cleanup_succeeded: boolean | null;
  reason_code: string | null;
}

export interface ExecutionIssue {
  component: string;
  reason_code: string;
  message: string;
  retryable: boolean;
}

export interface CapabilityReason {
  code: string;
  message: string;
}

export interface PreflightCapabilities {
  ffprobe_available: boolean;
  ffmpeg_available: boolean;
  gemini_dependency_available: boolean;
  gemini_api_key_configured: boolean;
  full_review_available: boolean;
  local_checks_available: boolean;
  transcription_dependency_available: boolean;
  transcription_enabled: boolean;
  supported_review_modes: ReviewMode[];
  maximum_video_upload_size_bytes: number;
  full_review_unavailable_reasons: CapabilityReason[];
}

export type PromiseCheckStatus = "disabled" | "aligned" | "needs_review" | "not_evaluable" | "unavailable";

export interface PromiseCheckSummary {
  status: PromiseCheckStatus;
  inferred_promise: string | null;
  first_substantive_address_seconds: number | null;
  first_substantive_address_evidence: string | null;
  overall_delivery: "aligned" | "partial" | "mismatched" | "not_evaluable" | null;
  explanation: string | null;
  confidence: number | null;
  thumbnail_alignment: "aligned" | "mismatched" | "not_evaluable" | null;
}

export type ViewerPassStatus = "disabled" | "clean" | "needs_review" | "not_evaluable" | "unavailable";

export interface ViewerPassSummary {
  status: ViewerPassStatus;
  summary: string | null;
  issue_count: number;
}

export type ClaimReviewStatus = "disabled" | "no_claims" | "clean" | "needs_review" | "unavailable";

export interface ClaimReviewSummary {
  status: ClaimReviewStatus;
  claims_checked: number;
  supported_count: number;
  conflict_count: number;
  insufficient_evidence_count: number;
  explanation: string | null;
}

export interface PreflightReport {
  schema_version: string;
  verdict: FindingStatus;
  scan_completeness: ScanCompleteness;
  review_mode: ReviewMode;
  execution_issues: ExecutionIssue[];
  media: MediaInspection;
  findings: Finding[];
  checks: CheckResult[];
  checks_run_count: number;
  passed_check_count: number;
  warning_count: number;
  critical_count: number;
  configuration_profile: string;
  configuration_source: string | null;
  caption_summary: CaptionSummary | null;
  ai_review: AIReviewSummary;
  promise_check: PromiseCheckSummary;
  viewer_pass: ViewerPassSummary;
  claim_review: ClaimReviewSummary;
  scan_duration_seconds: number;
}
