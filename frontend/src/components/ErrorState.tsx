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
      <section className="error-card panel">
        <span className="error-icon"><AlertTriangle aria-hidden="true" /></span>
        <p className="eyebrow">Application error</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {detail && <div className="error-detail">{detail}</div>}
        <button className="primary-button" type="button" onClick={onRetry}>
          <RotateCcw aria-hidden="true" /> Return to new scan
        </button>
        <small>This is a runtime failure, not a BLOCKED preflight verdict.</small>
      </section>
    </main>
  );
}
