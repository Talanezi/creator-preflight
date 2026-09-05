import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ErrorState } from "./components/ErrorState";
import { ResultsView } from "./components/ResultsView";
import { blockedReport, needsReviewReport, readyReport } from "./mocks/reports";
import type { PreflightReport } from "./types/preflight";
import { formatTimecode } from "./utils/format";

const createObjectURL = vi.fn(() => "blob:creator-preflight-local-preview");
const revokeObjectURL = vi.fn();
const NativeURL = URL;

class TestURL extends NativeURL {
  static createObjectURL = createObjectURL;
  static revokeObjectURL = revokeObjectURL;
}

beforeEach(() => {
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(capabilitiesFixture())));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Creator Preflight frontend", () => {
  it("disables Run Preflight until a video is selected", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /run preflight/i })).toBeDisabled();
    expect(screen.getByText(/timing, structure, and coverage checks/i)).toBeInTheDocument();
    expect(screen.queryByText(/caption contents are not inspected/i)).not.toBeInTheDocument();
  });

  it("offers explicit Full Review and Local Checks modes from backend capabilities", async () => {
    render(<App />);
    const full = await screen.findByRole("radio", { name: /Full Review/i });
    const local = screen.getByRole("radio", { name: /Local Checks Only/i });
    expect(full).toBeChecked();
    expect(local).not.toBeChecked();
    expect(screen.getByText(/Temporarily sends the video and thumbnail to Gemini/i)).toBeInTheDocument();
    expect(screen.getByText(/No Gemini media upload/i)).toBeInTheDocument();
  });

  it("disables Full Review when backend capabilities say it is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(capabilitiesFixture(false))));
    render(<App />);
    expect(await screen.findByRole("radio", { name: /Full Review/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Local Checks Only/i })).toBeChecked();
    expect(screen.getByText(/Full Review unavailable/i)).toBeInTheDocument();
  });

  it("clears native file inputs when selections are removed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const videoInput = screen.getByLabelText("Select video file") as HTMLInputElement;
    const captionInput = screen.getByLabelText("Select optional captions file") as HTMLInputElement;
    const thumbnailInput = screen.getByLabelText("Select optional thumbnail file") as HTMLInputElement;
    await user.upload(videoInput, new File(["video"], "same video.mp4", { type: "video/mp4" }));
    await user.upload(captionInput, new File(["captions"], "same captions.srt", { type: "text/plain" }));
    await user.upload(thumbnailInput, new File(["image"], "same thumbnail.png", { type: "image/png" }));

    await user.click(screen.getByRole("button", { name: "Remove thumbnail file" }));
    await user.click(screen.getByRole("button", { name: "Remove captions file" }));
    await user.click(screen.getByRole("button", { name: "Remove selected video" }));

    expect(videoInput.value).toBe("");
    expect(captionInput.value).toBe("");
    expect(thumbnailInput.value).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:creator-preflight-local-preview");
    expect(screen.getByRole("button", { name: /run preflight/i })).toBeDisabled();
  });

  it("renders the report verdict, counts, and typed findings", () => {
    render(<ResultsView report={needsReviewReport} />);
    const findings = within(screen.getByRole("region", { name: "Findings" }));

    expect(screen.getByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(findings.getByText("Sustained near-black section")).toBeInTheDocument();
    expect(findings.getByText("Long silent section")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan counts")).toHaveTextContent("9 passed·5 warnings·0 critical");
  });

  it("separates a partial scan from the content verdict", () => {
    render(<ResultsView report={{
      ...readyReport,
      review_mode: "full",
      scan_completeness: "PARTIAL",
      execution_issues: [{
        component: "ai.provider",
        reason_code: "ai_provider_quota_exhausted",
        message: "Gemini quota was reached.",
        retryable: true,
      }],
      ai_review: { ...readyReport.ai_review, enabled: true, status: "unavailable", reason_code: "ai_provider_quota_exhausted" },
      promise_check: { ...readyReport.promise_check, status: "unavailable", explanation: "Gemini quota was reached." },
      viewer_pass: { ...readyReport.viewer_pass, status: "unavailable", summary: "Gemini quota was reached." },
      claim_review: { ...readyReport.claim_review, status: "unavailable", explanation: "Gemini quota was reached." },
    }} />);
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scan incomplete" })).toBeInTheDocument();
    expect(screen.getByText(/Completed content checks found no release issue/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Gemini quota was reached/i).length).toBeGreaterThan(0);
  });

  it("does not present remote review cards for Local Checks Only", () => {
    render(<ResultsView report={readyReport} />);
    expect(screen.queryByRole("heading", { name: "Promise Check" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Final Viewer Pass" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Claim Review" })).not.toBeInTheDocument();
  });

  it("filters the visible findings by real report category", async () => {
    const user = userEvent.setup();
    render(<ResultsView report={needsReviewReport} />);

    await user.click(screen.getByRole("button", { name: "Audio 2" }));
    const findings = within(screen.getByRole("region", { name: "Findings" }));

    expect(findings.getByText("Long silent section")).toBeInTheDocument();
    expect(findings.getByText("Audio peak near full scale")).toBeInTheDocument();
    expect(findings.queryByText("Sustained near-black section")).not.toBeInTheDocument();
    expect(findings.queryByText("Title exceeds recommended length")).not.toBeInTheDocument();
  });

  it("renders global findings without inventing a timestamp", () => {
    render(<ResultsView report={needsReviewReport} />);
    const title = within(screen.getByRole("region", { name: "Findings" })).getByText("Title exceeds recommended length");
    const item = title.closest("article");

    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText("Package")).toBeInTheDocument();
    expect(within(item as HTMLElement).queryByRole("button", { name: /00:/ })).not.toBeInTheDocument();
  });

  it("formats numeric timestamps as stable timecodes", () => {
    expect(formatTimecode(2)).toBe("00:02.00");
    expect(formatTimecode(3723.5)).toBe("01:02:03.50");
  });

  it("seeks the local video when a timestamp action is clicked", async () => {
    const user = userEvent.setup();
    render(<ResultsView report={needsReviewReport} previewUrl="blob:creator-preflight-test" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    video.currentTime = 0;

    await user.click(within(screen.getByRole("region", { name: "Findings" })).getByRole("button", { name: "00:02.00–00:05.00" }));

    expect(video.currentTime).toBe(2);
  });

  it("seeks the local video when a timeline marker is clicked", async () => {
    const user = userEvent.setup();
    render(<ResultsView report={needsReviewReport} previewUrl="blob:creator-preflight-test" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    video.currentTime = 0;

    await user.click(screen.getByRole("button", {
      name: "Seek to Sustained static-frame section at 00:07.00–00:10.00",
    }));

    expect(video.currentTime).toBe(7);
  });

  it("renders real caption findings and seeks a timestamped caption gap", async () => {
    const user = userEvent.setup();
    const report = captionFindingReport();
    render(<ResultsView report={report} previewUrl="blob:caption-preview" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;

    expect(screen.getByRole("button", { name: "Captions 2" })).toBeInTheDocument();
    expect(screen.getByText("Possible caption gap")).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Findings" })).getByRole("button", { name: "00:07.00–00:10.00" }));
    expect(video.currentTime).toBe(7);
  });

  it("keeps a global caption parse finding off the video timeline", () => {
    render(<ResultsView report={captionFindingReport()} />);

    expect(screen.queryByRole("button", { name: /Seek to Caption file could not be parsed/ })).not.toBeInTheDocument();
    expect(screen.getByText("Caption file could not be parsed cleanly")).toBeInTheDocument();
    expect(screen.getByText("1 timed finding")).toBeInTheDocument();
  });

  it("renders AI-sourced review evidence without a separate UI contract", () => {
    const report: PreflightReport = {
      ...needsReviewReport,
      findings: [{
        code: "AI_REVIEW_VISUAL_CHANGE",
        severity: "warning",
        status: "NEEDS_REVIEW",
        message: "The background changes from blue to green.",
        source: "ai.gemini",
        timestamp_start_seconds: 4,
        timestamp_end_seconds: 4.5,
        details: {
          category: "ai",
          title: "Background changes",
          confidence: 0.95,
          provider: "gemini",
          model: "gemini-3.7-flash",
        },
        suggestion: null,
      }],
      warning_count: 1,
      ai_review: {
        enabled: true,
        provider: "gemini",
        model: "gemini-3.7-flash",
        status: "succeeded",
        observation_count: 1,
        runtime_seconds: 2.4,
        cleanup_succeeded: true,
        reason_code: null,
      },
    };

    render(<ResultsView report={report} />);

    expect(screen.getByRole("button", { name: "AI 1" })).toBeInTheDocument();
    expect(screen.getByText("Background changes")).toBeInTheDocument();
    expect(screen.getByText("The background changes from blue to green.")).toBeInTheDocument();
  });

  it("renders aligned Promise Check evidence without inventing a finding", () => {
    const report: PreflightReport = {
      ...readyReport,
      review_mode: "full",
      promise_check: {
        status: "aligned",
        inferred_promise: "Explain why blue light can disrupt sleep.",
        first_substantive_address_seconds: 8,
        first_substantive_address_evidence: "The explanation begins.",
        overall_delivery: "aligned",
        explanation: "The video delivers the title.",
        confidence: 0.95,
        thumbnail_alignment: "aligned",
      },
    };
    render(<ResultsView report={report} />);
    expect(screen.getByRole("heading", { name: "Promise Check" })).toBeInTheDocument();
    expect(screen.getByText("Explain why blue light can disrupt sleep.")).toBeInTheDocument();
    expect(screen.getByText("00:08.00")).toBeInTheDocument();
    expect(screen.getByText("Aligned", { selector: ".promise-summary strong" })).toBeInTheDocument();
  });

  it("renders a warning Promise finding and keeps it seekable", async () => {
    const user = userEvent.setup();
    const finding = {
      code: "AI_TITLE_CONTENT_MISMATCH",
      severity: "warning" as const,
      status: "NEEDS_REVIEW" as const,
      message: "Substantive delivery begins after the configured window.",
      source: "ai.gemini.promise",
      timestamp_start_seconds: 12,
      timestamp_end_seconds: 24,
      details: { category: "editorial", title: "Title and video may not align", confidence: 0.94 },
      suggestion: "Review whether the opening should reach the subject sooner.",
    };
    const report: PreflightReport = {
      ...needsReviewReport,
      review_mode: "full",
      findings: [finding],
      warning_count: 1,
      promise_check: {
        status: "needs_review",
        inferred_promise: "Explain the promised subject.",
        first_substantive_address_seconds: 24,
        first_substantive_address_evidence: "The explanation begins.",
        overall_delivery: "aligned",
        explanation: "The promise is ultimately delivered.",
        confidence: 0.94,
        thumbnail_alignment: null,
      },
    };
    render(<ResultsView report={report} previewUrl="blob:promise-preview" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    expect(screen.getByRole("button", { name: "Editorial 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "00:12.00–00:24.00" }));
    expect(video.currentTime).toBe(12);
  });

  it("renders a clean Final Viewer Pass summary without inventing a finding", () => {
    const report: PreflightReport = {
      ...readyReport,
      review_mode: "full",
      viewer_pass: {
        status: "clean",
        summary: "No high-confidence internal inconsistencies were found.",
        issue_count: 0,
      },
    };
    render(<ResultsView report={report} />);
    expect(screen.getByRole("heading", { name: "Final Viewer Pass" })).toBeInTheDocument();
    expect(screen.getByText("No high-confidence inconsistencies found")).toBeInTheDocument();
    expect(screen.getByText("No high-confidence internal inconsistencies were found.")).toBeInTheDocument();
  });

  it("renders and seeks a Viewer Pass editorial finding", async () => {
    const user = userEvent.setup();
    const finding = {
      code: "AI_NARRATION_VISUAL_CONFLICT",
      severity: "warning" as const,
      status: "NEEDS_REVIEW" as const,
      message: "Narration says 2021 while the graphic says 2020.",
      source: "ai.gemini.viewer",
      timestamp_start_seconds: 4,
      timestamp_end_seconds: 8,
      details: {
        category: "editorial",
        title: "Possible narration / graphic conflict",
        confidence: 0.95,
      },
      suggestion: "Review which value was intended before publishing.",
    };
    const report: PreflightReport = {
      ...needsReviewReport,
      review_mode: "full",
      findings: [finding],
      warning_count: 1,
      viewer_pass: {
        status: "needs_review",
        summary: "One internal inconsistency needs review.",
        issue_count: 1,
      },
    };
    render(<ResultsView report={report} previewUrl="blob:viewer-preview" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    expect(screen.getByText("1 item to review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "00:04.00–00:08.00" }));
    expect(video.currentTime).toBe(4);
  });

  it("renders backend-owned repair classes, previews, approvals, multiple apply, and download", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(repairVideoResponse())));
    const user = userEvent.setup();
    const report = repairWorkflowReport();
    const source = new File(["original-video"], "original cut.mp4", { type: "video/mp4" });
    render(<ResultsView report={report} previewUrl="blob:original" sourceFile={source} />);

    expect(screen.getByText("1 safe repair · 1 to preview · 1 need your judgment")).toBeInTheDocument();
    expect(screen.getByText("Safe repair")).toBeInTheDocument();
    expect(screen.getByText("Preview required")).toBeInTheDocument();
    expect(screen.getByText("Your judgment")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Preview repair" })[0]);
    expect(await screen.findByTestId("repair-preview-video")).toBeInTheDocument();
    expect(screen.getByText("Original context")).toBeInTheDocument();
    expect(screen.getByText("Proposed repair")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve repair" }));
    expect(screen.getByRole("button", { name: /Apply 1 approved repair/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove approval" }));
    expect(screen.queryByRole("button", { name: /Apply approved/ })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Preview repair" })[0]);
    await screen.findByTestId("repair-preview-video");
    await user.click(screen.getByRole("button", { name: "Approve repair" }));
    await user.click(screen.getByRole("button", { name: "Preview repair" }));
    await screen.findByTestId("repair-preview-video");
    await user.click(screen.getByRole("button", { name: "Approve repair" }));

    await user.click(screen.getByRole("button", { name: /Apply 2 approved repairs/ }));
    expect(await screen.findByRole("heading", { name: "Repaired video" })).toBeInTheDocument();
    expect(screen.getByTestId("repaired-video")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download repaired video" })).toHaveAttribute(
      "download", "original cut.repaired.mp4",
    );
  });

  it("keeps the original report usable when repair preview rendering fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "repair_render_failed", message: "FFmpeg could not render the proposed repair.", details: null },
    }, 400)));
    const user = userEvent.setup();
    render(<ResultsView
      report={needsReviewReport}
      previewUrl="blob:original"
      sourceFile={new File(["video"], "source.mp4", { type: "video/mp4" })}
    />);

    await user.click(screen.getByRole("button", { name: "Preview repair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("FFmpeg could not render the proposed repair.");
    expect(screen.getByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve repair" })).toBeDisabled();
  });

  it("New scan clears approvals, repaired media, and repair object URLs", async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilitiesFixture()));
      if (path.endsWith("/preflight/scan")) return Promise.resolve(jsonResponse(needsReviewReport));
      return Promise.resolve(repairVideoResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await selectVideoAndRun(user, "repair-source.mp4");

    await user.click(await screen.findByRole("button", { name: "Preview repair" }));
    await screen.findByTestId("repair-preview-video");
    await user.click(screen.getByRole("button", { name: "Approve repair" }));
    await user.click(screen.getByRole("button", { name: /Apply 1 approved repair/ }));
    expect(await screen.findByRole("heading", { name: "Repaired video" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New scan" }));
    expect(screen.getByTestId("input-state")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Repair queue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Repaired video" })).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("renders grounded Claim Review sources and seeks the claim timestamp", async () => {
    const user = userEvent.setup();
    const report: PreflightReport = {
      ...needsReviewReport,
      review_mode: "full",
      findings: [{
        code: "AI_CLAIM_POSSIBLE_CONFLICT",
        severity: "warning",
        status: "NEEDS_REVIEW",
        message: "The video states 1968; grounded evidence may conflict with that date.",
        source: "ai.gemini.claims",
        timestamp_start_seconds: 14,
        timestamp_end_seconds: null,
        details: {
          category: "claims",
          title: "Possible factual conflict",
          confidence: 0.98,
          sources: [{ title: "NASA", url: "https://www.nasa.gov/history/apollo-11" }],
        },
        suggestion: "Review the claim against the cited source.",
      }],
      warning_count: 1,
      claim_review: {
        status: "needs_review",
        claims_checked: 2,
        supported_count: 1,
        conflict_count: 1,
        insufficient_evidence_count: 0,
        explanation: "Only grounded conflicts become findings.",
      },
    };
    render(<ResultsView report={report} previewUrl="blob:claims-preview" />);
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    expect(screen.getByRole("heading", { name: "Claim Review" })).toBeInTheDocument();
    expect(screen.getByText("2 checked · 1 to review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claims 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NASA" })).toHaveAttribute(
      "href", "https://www.nasa.gov/history/apollo-11",
    );
    await user.click(screen.getByRole("button", { name: "00:14.00" }));
    expect(video.currentTime).toBe(14);
  });

  it.each([
    [readyReport, "Ready"],
    [needsReviewReport, "Needs review"],
    [blockedReport, "Blocked"],
  ] as const)("renders a successful backend %s report as %s", async (report, heading) => {
    vi.stubGlobal("fetch", appFetch([() => Promise.resolve(jsonResponse(report))]));
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, `${heading}.mp4`);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
  });

  it("renders a backend/network failure through the application error state", async () => {
    vi.stubGlobal("fetch", appFetch([
      () => Promise.reject(new TypeError("network failed")),
      () => Promise.resolve(jsonResponse(readyReport)),
    ]));
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, "unreachable.mp4");

    expect(await screen.findByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Creator Preflight is unavailable" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Return to new scan" }));
    expect(screen.getByTestId("selected-video")).toHaveTextContent("unreachable.mp4");
    await user.click(screen.getByRole("button", { name: "Run Preflight" }));
    expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  });

  it("aborts an obsolete request and ignores it even if it later resolves", async () => {
    let requestSignal: AbortSignal | undefined;
    let resolveObsolete: ((response: Response) => void) | undefined;
    let scanCall = 0;
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilitiesFixture()));
      scanCall += 1;
      if (scanCall === 1) {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => { resolveObsolete = resolve; });
      }
      return Promise.resolve(jsonResponse(readyReport));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, "obsolete.mp4");
    expect(await screen.findByTestId("processing-state")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New scan" }));
    await selectVideoAndRun(user, "current.mp4");
    expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
    resolveObsolete?.(jsonResponse(blockedReport));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument());

    expect(requestSignal?.aborted).toBe(true);
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Blocked" })).not.toBeInTheDocument();
  });

  it("replaces the first scan cleanly with a second real response", async () => {
    const fetchMock = appFetch([
      () => Promise.resolve(jsonResponse(readyReport)),
      () => Promise.resolve(jsonResponse(blockedReport)),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, "video-a.mp4");
    expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "video-a.mp4" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New scan" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:creator-preflight-local-preview");

    await selectVideoAndRun(user, "video-b.mp4");
    expect(await screen.findByRole("heading", { name: "Blocked" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "video-b.mp4" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "video-a.mp4" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Findings" })).getByText("Video height below minimum")).toBeInTheDocument();
  });

  it("keeps a pending real request in an honest indeterminate state", async () => {
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => (
      String(url).endsWith("/capabilities")
        ? Promise.resolve(jsonResponse(capabilitiesFixture()))
        : new Promise<Response>(() => undefined)
    )));
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, "pending.mp4");

    expect(await screen.findByRole("heading", { name: "Running preflight checks" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Preview application state")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspecting media")).not.toBeInTheDocument();
    expect(screen.queryByTestId("result-state")).not.toBeInTheDocument();
  });

  it("renders a separate reusable application error state", () => {
    render(
      <ErrorState
        title="Analysis could not start"
        message="The local backend failed."
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analysis could not start" })).toBeInTheDocument();
    expect(screen.getByText(/different from a blocked publishing result/i)).toBeInTheDocument();
  });

  it("handles unusually long finding content without crashing", () => {
    const longReport: PreflightReport = {
      ...needsReviewReport,
      findings: [{
        ...needsReviewReport.findings[0],
        message: `Long diagnostic ${"detail ".repeat(180)}`,
        details: {
          ...needsReviewReport.findings[0].details,
          title: `Long title ${"segment ".repeat(40)}`,
        },
      }],
      warning_count: 1,
    };

    render(<ResultsView report={longReport} />);
    expect(screen.getByText(/Long diagnostic/)).toBeInTheDocument();
  });
});

async function selectVideoAndRun(user: ReturnType<typeof userEvent.setup>, filename: string) {
  const video = new File(["synthetic video bytes"], filename, { type: "video/mp4" });
  await user.upload(screen.getByLabelText("Select video file"), video);
  await user.click(screen.getByRole("button", { name: "Run Preflight" }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function capabilitiesFixture(fullReviewAvailable = true) {
  return {
    ffprobe_available: true,
    ffmpeg_available: true,
    gemini_dependency_available: fullReviewAvailable,
    gemini_api_key_configured: fullReviewAvailable,
    full_review_available: fullReviewAvailable,
    local_checks_available: true,
    transcription_dependency_available: true,
    transcription_enabled: false,
    supported_review_modes: ["full", "local"],
    maximum_video_upload_size_bytes: 2_147_483_648,
    full_review_unavailable_reasons: fullReviewAvailable ? [] : [{
      code: "gemini_api_key_missing",
      message: "The backend does not have a Gemini API key configured.",
    }],
  };
}

function appFetch(
  scanResponses: Array<() => Promise<Response>>,
): ReturnType<typeof vi.fn> {
  let scanIndex = 0;
  return vi.fn((url: RequestInfo | URL) => {
    if (String(url).endsWith("/capabilities")) {
      return Promise.resolve(jsonResponse(capabilitiesFixture()));
    }
    const response = scanResponses[scanIndex++];
    return response ? response() : Promise.reject(new Error("Unexpected scan request"));
  });
}

function captionFindingReport(): PreflightReport {
  return {
    ...needsReviewReport,
    findings: [
      {
        code: "CAPTION_SPEECH_GAP",
        severity: "warning",
        status: "NEEDS_REVIEW",
        message: "Speech was detected here with little or no caption coverage.",
        source: "captions.speech",
        timestamp_start_seconds: 7,
        timestamp_end_seconds: 10,
        details: {
          category: "captions",
          title: "Possible caption gap",
          duration_seconds: 3,
        },
        suggestion: "Review this section and confirm that spoken content is captioned.",
      },
      {
        code: "CAPTION_PARSE_ERROR",
        severity: "warning",
        status: "NEEDS_REVIEW",
        message: "The supplied caption file contains malformed cue syntax.",
        source: "captions.validation",
        timestamp_start_seconds: null,
        timestamp_end_seconds: null,
        details: {
          category: "captions",
          title: "Caption file could not be parsed cleanly",
        },
        suggestion: "Correct the caption syntax.",
      },
    ],
    caption_summary: {
      source_format: "srt",
      cue_count: 2,
      first_caption_seconds: 0,
      last_caption_seconds: 5,
      covered_duration_seconds: 4,
      timeline_coverage_percent: 33.333,
    },
    warning_count: 2,
  };
}

function repairWorkflowReport(): PreflightReport {
  const duplicate = {
    code: "AI_ACCIDENTAL_REPETITION",
    severity: "warning" as const,
    status: "NEEDS_REVIEW" as const,
    message: "A substantial sequence appears twice.",
    source: "ai.gemini.viewer",
    timestamp_start_seconds: 7,
    timestamp_end_seconds: 10,
    details: {
      category: "editorial",
      title: "Possible duplicated segment",
      original_start_seconds: 4,
      original_end_seconds: 7,
    },
    suggestion: "Review whether the repetition is intentional.",
  };
  const human = needsReviewReport.findings.find((finding) => finding.code === "AUDIO_LONG_SILENCE")!;
  const black = needsReviewReport.findings.find((finding) => finding.code === "VIDEO_BLACK_SEGMENT")!;
  return {
    ...needsReviewReport,
    findings: [black, duplicate, human],
    warning_count: 3,
    repair_plan: {
      proposals: [
        {
          proposal_id: "duplicate-repair",
          finding_code: duplicate.code,
          finding_title: "Possible duplicated segment",
          explanation: "Remove the repeated occurrence while retaining the original reference interval.",
          source: duplicate.source,
          repairability: "SAFE",
          operation: { operation_type: "REMOVE_RANGE", start_seconds: 7, end_seconds: 10 },
          start_seconds: 7,
          end_seconds: 10,
          expected_duration_change_seconds: -3,
          original_start_seconds: 4,
          original_end_seconds: 7,
          evidence: duplicate.details,
        },
        {
          proposal_id: "black-repair",
          finding_code: black.code,
          finding_title: "Sustained near-black section",
          explanation: "Remove the black interval and ripple the remaining video and audio together.",
          source: black.source,
          repairability: "PREVIEW_REQUIRED",
          operation: { operation_type: "REMOVE_RANGE", start_seconds: 2, end_seconds: 5 },
          start_seconds: 2,
          end_seconds: 5,
          expected_duration_change_seconds: -3,
          original_start_seconds: null,
          original_end_seconds: null,
          evidence: black.details,
        },
        {
          proposal_id: "human-review",
          finding_code: human.code,
          finding_title: "Long silent section",
          explanation: "Creator Preflight cannot make this edit without your judgment.",
          source: human.source,
          repairability: "HUMAN_ONLY",
          operation: null,
          start_seconds: human.timestamp_start_seconds,
          end_seconds: human.timestamp_end_seconds,
          expected_duration_change_seconds: null,
          original_start_seconds: null,
          original_end_seconds: null,
          evidence: human.details,
        },
      ],
      safe_count: 1,
      preview_required_count: 1,
      human_only_count: 1,
    },
  };
}

function repairVideoResponse(): Response {
  return new Response(new Blob(["repaired-video"], { type: "video/mp4" }), {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "X-Repair-Original-Duration": "12",
      "X-Repair-Output-Duration": "6",
      "X-Repair-Removed-Duration": "3",
    },
  });
}
