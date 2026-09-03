export type FindingSeverity = "info" | "warning" | "error";
export type FindingStatus = "READY" | "NEEDS_REVIEW" | "BLOCKED";

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

export interface PreflightReport {
  schema_version: string;
  verdict: FindingStatus;
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
  scan_duration_seconds: number;
}
