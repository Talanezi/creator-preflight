import { afterEach, describe, expect, it, vi } from "vitest";
import { needsReviewReport } from "../mocks/reports";
import { fetchCapabilities, PreflightApiError, scanPreflight } from "./preflight";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preflight API client", () => {
  it("loads typed non-secret backend capabilities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(capabilitiesFixture())));
    const capabilities = await fetchCapabilities();
    expect(capabilities.full_review_available).toBe(true);
    expect(capabilities.supported_review_modes).toEqual(["full", "local"]);
    expect(capabilities.maximum_video_upload_size_bytes).toBe(2_147_483_648);
  });

  it("constructs the exact multipart scan request without overriding Content-Type", async () => {
    let requestUrl: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = url;
      requestInit = init;
      return Promise.resolve(jsonResponse(needsReviewReport));
    }));
    const video = new File(["video"], "real video.mp4", { type: "video/mp4" });
    const captions = new File(["WEBVTT"], "captions.vtt", { type: "text/vtt" });
    const thumbnail = new File(["png"], "thumbnail.png", { type: "image/png" });

    const report = await scanPreflight({
      video,
      title: "Exact title",
      description: "First line\nSecond line",
      captions,
      thumbnail,
      reviewMode: "full",
    });

    expect(requestUrl).toBe("/api/v1/preflight/scan");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toBeUndefined();
    expect(requestInit?.body).toBeInstanceOf(FormData);
    const form = requestInit?.body as FormData;
    const uploadedVideo = form.get("file");
    const uploadedCaptions = form.get("captions");
    const uploadedThumbnail = form.get("thumbnail");
    expect(uploadedVideo).toBeInstanceOf(File);
    expect((uploadedVideo as File).name).toBe("real video.mp4");
    expect((uploadedVideo as File).size).toBe(video.size);
    expect(form.get("title")).toBe("Exact title");
    expect(form.get("description")).toBe("First line\nSecond line");
    expect(form.get("review_mode")).toBe("full");
    expect(uploadedCaptions).toBeInstanceOf(File);
    expect((uploadedCaptions as File).name).toBe("captions.vtt");
    expect((uploadedCaptions as File).size).toBe(captions.size);
    expect(uploadedThumbnail).toBeInstanceOf(File);
    expect((uploadedThumbnail as File).name).toBe("thumbnail.png");
    expect(report).toEqual(needsReviewReport);
  });

  it("omits optional captions and thumbnail when none were selected", async () => {
    let body: FormData | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      body = init?.body as FormData;
      return Promise.resolve(jsonResponse(needsReviewReport));
    }));

    await scanPreflight({
      video: new File(["video"], "video.mp4", { type: "video/mp4" }),
      title: "Title",
      description: "Description",
      reviewMode: "local",
    });

    expect(body?.has("captions")).toBe(false);
    expect(body?.has("thumbnail")).toBe(false);
  });

  it("surfaces a safe structured invalid-media error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: "invalid_media",
        message: "FFprobe could not parse the supplied media file.",
        details: { ffprobe_exit_code: 1 },
      },
    }, 400)));

    await expect(scanPreflight({
      video: new File(["bad"], "bad.mp4", { type: "video/mp4" }),
      title: "",
      description: "",
      reviewMode: "local",
    })).rejects.toMatchObject({
      code: "invalid_media",
      message: "FFprobe could not parse the supplied media file.",
      status: 400,
    });
  });

  it("rejects a malformed successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ verdict: "READY" })));

    await expect(scanPreflight({
      video: new File(["video"], "video.mp4", { type: "video/mp4" }),
      title: "Title",
      description: "Description",
      reviewMode: "local",
    })).rejects.toBeInstanceOf(PreflightApiError);
  });

  it("accepts the real caption summary contract", async () => {
    const captionReport = {
      ...needsReviewReport,
      caption_summary: {
        source_format: "vtt",
        cue_count: 3,
        first_caption_seconds: 0,
        last_caption_seconds: 12,
        covered_duration_seconds: 10.5,
        timeline_coverage_percent: 87.5,
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(captionReport)));

    const report = await scanPreflight({
      video: new File(["video"], "video.mp4", { type: "video/mp4" }),
      title: "Title",
      description: "Description",
      reviewMode: "local",
    });

    expect(report.caption_summary).toEqual(captionReport.caption_summary);
  });

  it("rejects a malformed Promise Check summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ...needsReviewReport,
      promise_check: { ...needsReviewReport.promise_check, status: "pretend_aligned" },
    })));
    await expect(scanPreflight({
      video: new File(["video"], "video.mp4", { type: "video/mp4" }),
      title: "Title",
      description: "Description",
      reviewMode: "local",
    })).rejects.toMatchObject({ code: "invalid_response" });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function capabilitiesFixture() {
  return {
    ffprobe_available: true,
    ffmpeg_available: true,
    gemini_dependency_available: true,
    gemini_api_key_configured: true,
    full_review_available: true,
    local_checks_available: true,
    transcription_dependency_available: true,
    transcription_enabled: false,
    supported_review_modes: ["full", "local"],
    maximum_video_upload_size_bytes: 2_147_483_648,
    full_review_unavailable_reasons: [],
  };
}
