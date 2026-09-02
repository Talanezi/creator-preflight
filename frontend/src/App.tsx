import { useCallback, useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { ErrorState } from "./components/ErrorState";
import { ProcessingState } from "./components/ProcessingState";
import { ResultsView } from "./components/ResultsView";
import { ScanForm, type ScanInputs } from "./components/ScanForm";
import {
  blockedReport,
  needsReviewReport,
  readyReport,
  runtimeError,
} from "./mocks/reports";

export type ViewState = "input" | "processing" | "review" | "ready" | "blocked" | "error";

interface AppProps {
  initialView?: ViewState;
}

const emptyInputs: ScanInputs = {
  video: null,
  title: "",
  description: "",
  captions: null,
};

export function App({ initialView = "input" }: AppProps) {
  const [view, setView] = useState<ViewState>(initialView);
  const [inputs, setInputs] = useState<ScanInputs>(emptyInputs);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inputs.video || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(inputs.video);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [inputs.video]);

  const reset = useCallback(() => {
    setInputs(emptyInputs);
    setView("input");
  }, []);

  const report = view === "ready" ? readyReport : view === "blocked" ? blockedReport : needsReviewReport;

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong className="brand-name">Creator Preflight</strong>
        <div className="header-actions">
          <span className="local-indicator"><HardDrive aria-hidden="true" /> Local analysis</span>
          {view !== "input" && (
            <button className="header-action" type="button" onClick={reset}>New scan</button>
          )}
          <label className="development-state-picker visually-hidden">
            Preview application state
            <select
              aria-label="Preview application state"
              value={view}
              onChange={(event) => setView(event.target.value as ViewState)}
            >
              <option value="input">New scan</option>
              <option value="processing">Processing</option>
              <option value="review">Needs review</option>
              <option value="ready">Ready</option>
              <option value="blocked">Blocked</option>
              <option value="error">App error</option>
            </select>
          </label>
        </div>
      </header>

      {view === "input" && (
        <ScanForm inputs={inputs} onChange={setInputs} onRun={() => setView("processing")} />
      )}
      {view === "processing" && (
        <ProcessingState
          filename={inputs.video?.name ?? "creator-export-final.mp4"}
          onComplete={() => setView("review")}
        />
      )}
      {(view === "review" || view === "ready" || view === "blocked") && (
        <ResultsView
          report={report}
          filename={inputs.video?.name ?? "creator-export-final.mp4"}
          previewUrl={previewUrl}
        />
      )}
      {view === "error" && <ErrorState {...runtimeError} onRetry={reset} />}
    </div>
  );
}
