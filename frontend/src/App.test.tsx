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

  it("clears native file inputs when selections are removed", async () => {
    const user = userEvent.setup();
    render(<App />);
    const videoInput = screen.getByLabelText("Select video file") as HTMLInputElement;
    const captionInput = screen.getByLabelText("Select optional captions file") as HTMLInputElement;
    await user.upload(videoInput, new File(["video"], "same video.mp4", { type: "video/mp4" }));
    await user.upload(captionInput, new File(["captions"], "same captions.srt", { type: "text/plain" }));

    await user.click(screen.getByRole("button", { name: "Remove captions file" }));
    await user.click(screen.getByRole("button", { name: "Remove selected video" }));

    expect(videoInput.value).toBe("");
    expect(captionInput.value).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:creator-preflight-local-preview");
    expect(screen.getByRole("button", { name: /run preflight/i })).toBeDisabled();
  });

  it("renders the report verdict, counts, and typed findings", () => {
    render(<ResultsView report={needsReviewReport} />);

    expect(screen.getByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.getByText("Sustained near-black section")).toBeInTheDocument();
    expect(screen.getByText("Long silent section")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan counts")).toHaveTextContent("9 passed·5 warnings·0 critical");
  });

  it("filters the visible findings by real report category", async () => {
    const user = userEvent.setup();
    render(<ResultsView report={needsReviewReport} />);

    await user.click(screen.getByRole("button", { name: "Audio 2" }));

    expect(screen.getByText("Long silent section")).toBeInTheDocument();
    expect(screen.getByText("Audio peak near full scale")).toBeInTheDocument();
    expect(screen.queryByText("Sustained near-black section")).not.toBeInTheDocument();
    expect(screen.queryByText("Title exceeds recommended length")).not.toBeInTheDocument();
  });

  it("renders global findings without inventing a timestamp", () => {
    render(<ResultsView report={needsReviewReport} />);
    const title = screen.getByText("Title exceeds recommended length");
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

    await user.click(screen.getByRole("button", { name: "00:02.00–00:05.00" }));

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
    await user.click(screen.getByRole("button", { name: "00:07.00–00:10.00" }));
    expect(video.currentTime).toBe(7);
  });

  it("keeps a global caption parse finding off the video timeline", () => {
    render(<ResultsView report={captionFindingReport()} />);

    expect(screen.queryByRole("button", { name: /Seek to Caption file could not be parsed/ })).not.toBeInTheDocument();
    expect(screen.getByText("Caption file could not be parsed cleanly")).toBeInTheDocument();
    expect(screen.getByText("1 timed finding")).toBeInTheDocument();
  });

  it.each([
    [readyReport, "Ready"],
    [needsReviewReport, "Needs review"],
    [blockedReport, "Blocked"],
  ] as const)("renders a successful backend %s report as %s", async (report, heading) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(report)));
    const user = userEvent.setup();
    render(<App />);

    await selectVideoAndRun(user, `${heading}.mp4`);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
  });

  it("renders a backend/network failure through the application error state", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(jsonResponse(readyReport)));
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
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(readyReport))
      .mockResolvedValueOnce(jsonResponse(blockedReport));
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
    expect(screen.getByText("Video height below minimum")).toBeInTheDocument();
  });

  it("keeps a pending real request in an honest indeterminate state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
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
