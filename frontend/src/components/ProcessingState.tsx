import { LoaderCircle } from "lucide-react";

interface ProcessingStateProps {
  filename: string;
}

export function ProcessingState({ filename }: ProcessingStateProps) {
  return (
    <main className="processing page-frame" data-testid="processing-state">
      <section className="processing-surface">
        <LoaderCircle className="processing-spinner" aria-hidden="true" />
        <h1>Running preflight checks</h1>
        <p className="processing-file" title={filename}>Checking <strong>{filename}</strong></p>
        <p className="processing-explanation">
          Creator Preflight is inspecting the media and publishing package. The local backend returns the complete report when every check has finished.
        </p>
      </section>
    </main>
  );
}
