import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { ResultsView } from "./components/ResultsView";
import { needsReviewReport } from "./mocks/reports";
import type { PreflightReport } from "./types/preflight";
import { formatTimecode } from "./utils/format";

describe("Creator Preflight frontend", () => {
  it("disables Run Preflight until a video is selected", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /run preflight/i })).toBeDisabled();
  });

  it("renders the report verdict, counts, and typed findings", () => {
    render(<ResultsView report={needsReviewReport} onNewScan={() => undefined} />);

    expect(screen.getByRole("heading", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.getByText("Sustained near-black section")).toBeInTheDocument();
    expect(screen.getByText("Long silent section")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan counts")).toHaveTextContent("9Passed5Warnings0Critical");
  });

  it("filters the visible findings by real report category", async () => {
    const user = userEvent.setup();
    render(<ResultsView report={needsReviewReport} onNewScan={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Audio 2" }));

    expect(screen.getByText("Long silent section")).toBeInTheDocument();
    expect(screen.getByText("Audio peak near full scale")).toBeInTheDocument();
    expect(screen.queryByText("Sustained near-black section")).not.toBeInTheDocument();
    expect(screen.queryByText("Title exceeds recommended length")).not.toBeInTheDocument();
  });

  it("renders global findings without inventing a timestamp", () => {
    render(<ResultsView report={needsReviewReport} onNewScan={() => undefined} />);
    const title = screen.getByText("Title exceeds recommended length");
    const item = title.closest("article");

    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText("Package / global check")).toBeInTheDocument();
    expect(within(item as HTMLElement).queryByRole("button", { name: /00:/ })).not.toBeInTheDocument();
  });

  it("formats numeric timestamps as stable timecodes", () => {
    expect(formatTimecode(2)).toBe("00:02.00");
    expect(formatTimecode(3723.5)).toBe("01:02:03.50");
  });

  it("seeks the local video when a timestamp action is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ResultsView
        report={needsReviewReport}
        previewUrl="blob:creator-preflight-test"
        onNewScan={() => undefined}
      />,
    );
    const video = screen.getByTestId("preview-video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    video.currentTime = 0;

    await user.click(screen.getByRole("button", { name: "00:02.00–00:05.00" }));

    expect(video.currentTime).toBe(2);
  });

  it("renders the clean READY state", () => {
    render(<App initialView="ready" />);
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByText("No findings requiring review")).toBeInTheDocument();
    expect(screen.getByLabelText("Scan counts")).toHaveTextContent("14Passed0Warnings0Critical");
  });

  it("renders BLOCKED as a completed scan rather than an app crash", () => {
    render(<App initialView="blocked" />);
    expect(screen.getByRole("heading", { name: "Blocked" })).toBeInTheDocument();
    expect(screen.getByText("Video height below minimum")).toBeInTheDocument();
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
  });

  it("renders a separate reusable application error state", () => {
    render(<App initialView="error" />);
    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analysis could not start" })).toBeInTheDocument();
    expect(screen.getByText(/not a BLOCKED preflight verdict/i)).toBeInTheDocument();
  });

  it("handles unusually long finding content without crashing", () => {
    const longReport: PreflightReport = {
      ...needsReviewReport,
      findings: [
        {
          ...needsReviewReport.findings[0],
          message: `Long diagnostic ${"detail ".repeat(180)}`,
          details: {
            ...needsReviewReport.findings[0].details,
            title: `Long title ${"segment ".repeat(40)}`,
          },
        },
      ],
      warning_count: 1,
    };

    render(<ResultsView report={longReport} onNewScan={() => undefined} />);
    expect(screen.getByText(/Long diagnostic/)).toBeInTheDocument();
  });
});
