import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { errorPresentation, isAbortError, scanPreflight } from "./api/preflight";
import { ErrorState } from "./components/ErrorState";
import { ProcessingState } from "./components/ProcessingState";
import { ResultsView } from "./components/ResultsView";
import { ScanForm, type ScanInputs } from "./components/ScanForm";
import type { PreflightReport } from "./types/preflight";

type ViewState = "input" | "processing" | "result" | "error";

const emptyInputs: ScanInputs = {
  video: null,
  title: "",
  description: "",
  captions: null,
};

export function App() {
  const [view, setView] = useState<ViewState>("input");
  const [inputs, setInputs] = useState<ScanInputs>(emptyInputs);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<ReturnType<typeof errorPresentation> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!inputs.video || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(inputs.video);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [inputs.video]);

  useEffect(() => () => {
    requestSequence.current += 1;
    activeRequest.current?.abort();
  }, []);

  const reset = useCallback(() => {
    requestSequence.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setInputs(emptyInputs);
    setReport(null);
    setError(null);
    setView("input");
  }, []);

  const returnToForm = useCallback(() => {
    setReport(null);
    setError(null);
    setView("input");
  }, []);

  const runScan = useCallback(async () => {
    if (!inputs.video) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setReport(null);
    setError(null);
    setView("processing");

    try {
      const nextReport = await scanPreflight(
        {
          video: inputs.video,
          title: inputs.title,
          description: inputs.description,
          captions: inputs.captions,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || requestSequence.current !== sequence) return;
      setReport(nextReport);
      setView("result");
    } catch (scanError) {
      if (controller.signal.aborted || isAbortError(scanError) || requestSequence.current !== sequence) return;
      setError(errorPresentation(scanError));
      setView("error");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [inputs]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong className="brand-name">Creator Preflight</strong>
        <div className="header-actions">
          <span className="local-indicator"><HardDrive aria-hidden="true" /> Local analysis</span>
          {view !== "input" && (
            <button className="header-action" type="button" onClick={reset}>New scan</button>
          )}
        </div>
      </header>

      {view === "input" && (
        <ScanForm inputs={inputs} onChange={setInputs} onRun={() => void runScan()} />
      )}
      {view === "processing" && (
        <ProcessingState filename={inputs.video?.name ?? "selected video"} />
      )}
      {view === "result" && report && (
        <ResultsView
          key={requestSequence.current}
          report={report}
          filename={inputs.video?.name ?? "selected video"}
          previewUrl={previewUrl}
        />
      )}
      {view === "error" && error && <ErrorState {...error} onRetry={returnToForm} />}
    </div>
  );
}
