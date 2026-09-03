import type {
  CheckResult,
  CaptionSummary,
  AIReviewSummary,
  PromiseCheckSummary,
  ViewerPassSummary,
  Finding,
  MediaInspection,
  PreflightReport,
} from "../types/preflight";

export interface PreflightScanInput {
  video: File;
  title: string;
  description: string;
  captions?: File | null;
  thumbnail?: File | null;
}

interface StructuredErrorResponse {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
}

export class PreflightApiError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, options: { code: string; status?: number | null; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "PreflightApiError";
    this.code = options.code;
    this.status = options.status ?? null;
  }
}

export async function scanPreflight(
  input: PreflightScanInput,
  options: { signal?: AbortSignal } = {},
): Promise<PreflightReport> {
  const form = new FormData();
  form.append("file", input.video, input.video.name);
  form.append("title", input.title);
  form.append("description", input.description);
  if (input.captions) form.append("captions", input.captions, input.captions.name);
  if (input.thumbnail) form.append("thumbnail", input.thumbnail, input.thumbnail.name);

  let response: Response;
  try {
    response = await fetch("/api/v1/preflight/scan", {
      method: "POST",
      body: form,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new PreflightApiError(
      "Could not reach the local Creator Preflight backend.",
      { code: "backend_unreachable", cause: error },
    );
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const structured = parseStructuredError(payload);
    throw new PreflightApiError(
      structured?.error.message ?? `The preflight request failed with HTTP ${response.status}.`,
      {
        code: structured?.error.code ?? "request_failed",
        status: response.status,
      },
    );
  }
  if (!isPreflightReport(payload)) {
    throw new PreflightApiError(
      "The backend returned an unexpected preflight report.",
      { code: "invalid_response", status: response.status },
    );
  }
  return payload;
}

export function errorPresentation(error: unknown): { title: string; message: string; detail?: string } {
  if (error instanceof PreflightApiError) {
    if (error.code === "backend_unreachable") {
      return {
        title: "Creator Preflight is unavailable",
        message: error.message,
        detail: "Start the local FastAPI backend, then return to the scan and try again.",
      };
    }
    if (error.code === "media_tool_unavailable" || error.code.startsWith("ffprobe_")) {
      return {
        title: "Media tools are unavailable",
        message: error.message,
        detail: "Confirm FFmpeg and FFprobe are installed on the backend machine.",
      };
    }
    if (error.code === "invalid_media" || error.code === "empty_file") {
      return {
        title: "This file could not be analyzed",
        message: error.message,
        detail: "Choose a readable, non-empty media file and try again.",
      };
    }
    if (error.code.startsWith("thumbnail_")) {
      return {
        title: "This thumbnail could not be used",
        message: error.message,
        detail: "Choose a valid PNG or JPEG within the configured size limit.",
      };
    }
    return {
      title: "The scan could not be completed",
      message: error.message,
      detail: error.code === "invalid_response"
        ? "The local backend response did not match the expected report format."
        : undefined,
    };
  }
  return {
    title: "The scan could not be completed",
    message: "Creator Preflight encountered an unexpected application error.",
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return null;
    throw new PreflightApiError(
      "The backend returned an unreadable response.",
      { code: "invalid_response", status: response.status },
    );
  }
}

function parseStructuredError(value: unknown): StructuredErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  if (typeof value.error.code !== "string" || typeof value.error.message !== "string") return null;
  const details = value.error.details;
  if (details !== null && details !== undefined && !isRecord(details)) return null;
  return {
    error: {
      code: value.error.code,
      message: value.error.message,
      details: details ?? null,
    },
  };
}

function isPreflightReport(value: unknown): value is PreflightReport {
  if (!isRecord(value)) return false;
  return typeof value.schema_version === "string"
    && isFindingStatus(value.verdict)
    && isMediaInspection(value.media)
    && Array.isArray(value.findings)
    && value.findings.every(isFinding)
    && Array.isArray(value.checks)
    && value.checks.every(isCheckResult)
    && isNonnegativeNumber(value.checks_run_count)
    && isNonnegativeNumber(value.passed_check_count)
    && isNonnegativeNumber(value.warning_count)
    && isNonnegativeNumber(value.critical_count)
    && typeof value.configuration_profile === "string"
    && isNullableString(value.configuration_source)
    && (value.caption_summary === null || isCaptionSummary(value.caption_summary))
    && isAIReviewSummary(value.ai_review)
    && isPromiseCheckSummary(value.promise_check)
    && isViewerPassSummary(value.viewer_pass)
    && isNonnegativeNumber(value.scan_duration_seconds);
}

function isViewerPassSummary(value: unknown): value is ViewerPassSummary {
  return isRecord(value)
    && (value.status === "disabled" || value.status === "clean"
      || value.status === "needs_review" || value.status === "not_evaluable"
      || value.status === "unavailable")
    && isNullableString(value.summary)
    && isNonnegativeNumber(value.issue_count);
}

function isAIReviewSummary(value: unknown): value is AIReviewSummary {
  return isRecord(value)
    && typeof value.enabled === "boolean"
    && typeof value.provider === "string"
    && typeof value.model === "string"
    && (value.status === "disabled" || value.status === "not_run" || value.status === "succeeded"
      || value.status === "unavailable" || value.status === "failed")
    && isNonnegativeNumber(value.observation_count)
    && isNullableNumber(value.runtime_seconds)
    && (value.cleanup_succeeded === null || typeof value.cleanup_succeeded === "boolean")
    && isNullableString(value.reason_code);
}

function isPromiseCheckSummary(value: unknown): value is PromiseCheckSummary {
  return isRecord(value)
    && (value.status === "disabled" || value.status === "aligned"
      || value.status === "needs_review" || value.status === "not_evaluable"
      || value.status === "unavailable")
    && isNullableString(value.inferred_promise)
    && isNullableNumber(value.first_substantive_address_seconds)
    && isNullableString(value.first_substantive_address_evidence)
    && (value.overall_delivery === null || value.overall_delivery === "aligned"
      || value.overall_delivery === "partial" || value.overall_delivery === "mismatched"
      || value.overall_delivery === "not_evaluable")
    && isNullableString(value.explanation)
    && isNullableConfidence(value.confidence)
    && (value.thumbnail_alignment === null || value.thumbnail_alignment === "aligned"
      || value.thumbnail_alignment === "mismatched" || value.thumbnail_alignment === "not_evaluable");
}

function isCaptionSummary(value: unknown): value is CaptionSummary {
  return isRecord(value)
    && typeof value.source_format === "string"
    && isNonnegativeNumber(value.cue_count)
    && isNullableNumber(value.first_caption_seconds)
    && isNullableNumber(value.last_caption_seconds)
    && isNonnegativeNumber(value.covered_duration_seconds)
    && isNullablePercentage(value.timeline_coverage_percent);
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false;
  return typeof value.code === "string"
    && (value.severity === "info" || value.severity === "warning" || value.severity === "error")
    && isFindingStatus(value.status)
    && typeof value.message === "string"
    && typeof value.source === "string"
    && isNullableNumber(value.timestamp_start_seconds)
    && isNullableNumber(value.timestamp_end_seconds)
    && (value.details === null || (isRecord(value.details) && isJsonObject(value.details)))
    && isNullableString(value.suggestion);
}

function isCheckResult(value: unknown): value is CheckResult {
  return isRecord(value)
    && typeof value.check_id === "string"
    && typeof value.passed === "boolean"
    && Array.isArray(value.finding_codes)
    && value.finding_codes.every((code) => typeof code === "string");
}

function isMediaInspection(value: unknown): value is MediaInspection {
  if (!isRecord(value)) return false;
  return isNullableNumber(value.duration_seconds)
    && isNullableString(value.format_name)
    && isNonnegativeNumber(value.file_size_bytes)
    && typeof value.has_video === "boolean"
    && isNonnegativeNumber(value.video_stream_count)
    && isNullableString(value.video_codec)
    && isNullableNumber(value.width)
    && isNullableNumber(value.height)
    && isNullableString(value.display_aspect_ratio)
    && isNullableNumber(value.frame_rate)
    && isNullableString(value.pixel_format)
    && typeof value.has_audio === "boolean"
    && isNonnegativeNumber(value.audio_stream_count)
    && isNullableString(value.audio_codec)
    && isNullableNumber(value.channel_count)
    && isNullableNumber(value.sample_rate);
}

function isFindingStatus(value: unknown): value is PreflightReport["verdict"] {
  return value === "READY" || value === "NEEDS_REVIEW" || value === "BLOCKED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullablePercentage(value: unknown): value is number | null {
  return value === null || (isNonnegativeNumber(value) && value <= 100);
}

function isNullableConfidence(value: unknown): value is number | null {
  return value === null || (isNonnegativeNumber(value) && value <= 1);
}

function isJsonObject(value: Record<string, unknown>): boolean {
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && isJsonObject(value);
}
