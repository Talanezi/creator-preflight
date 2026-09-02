import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorStateProps {
  title: string;
  message: string;
  detail?: string;
  onRetry: () => void;
}

export function ErrorState({ title, message, detail, onRetry }: ErrorStateProps) {
  return (
    <main className="error-page page-frame" data-testid="error-state">
      <section className="error-surface">
        <span className="error-icon"><AlertTriangle aria-hidden="true" /></span>
        <h1>{title}</h1>
        <p>{message}</p>
        {detail && <p className="error-detail">{detail}</p>}
        <button className="primary-button" type="button" onClick={onRetry}>
          <RotateCcw aria-hidden="true" /> Return to new scan
        </button>
        <small>The scan did not complete. This is different from a blocked publishing result.</small>
      </section>
    </main>
  );
}
