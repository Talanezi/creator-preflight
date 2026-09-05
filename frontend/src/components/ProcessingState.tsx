import { LoaderCircle } from "lucide-react";

interface ProcessingStateProps {
  filename: string;
  reviewMode: "full" | "local";
}

export function ProcessingState({ filename, reviewMode }: ProcessingStateProps) {
  return (
    <main className="processing page-frame" data-testid="processing-state">
      <section className="processing-surface">
        <LoaderCircle className="processing-spinner" aria-hidden="true" />
        <h1>Running preflight checks</h1>
        <p className="processing-file" title={filename}>Checking <strong>{filename}</strong></p>
        <p className="processing-mode">{reviewMode === "full" ? "Full Review" : "Local Checks Only"}</p>
        <p className="processing-explanation">
          {reviewMode === "full"
            ? "Creator Preflight is running local checks and the selected Gemini review tasks. Results return together; no fake stage progress is shown."
            : "Creator Preflight is inspecting the media and publishing package locally. No media is sent to Gemini."}
        </p>
      </section>
    </main>
  );
}
