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
  scan_duration_seconds: number;
}
