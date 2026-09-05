import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Film, Play, RotateCcw, Scissors, X } from "lucide-react";
import { applyRepairs, errorPresentation, isAbortError, previewRepair } from "../api/preflight";
import type { PreflightReport, RepairOperation, RepairProposal } from "../types/preflight";
import { formatDuration, formatTimecode } from "../utils/format";

interface RepairPanelProps {
  report: PreflightReport;
  sourceFile: File | null;
  originalPreviewUrl?: string | null;
  onSeek: (seconds: number) => void;
}

export function RepairPanel({ report, sourceFile, originalPreviewUrl, onSeek }: RepairPanelProps) {
  const [activeProposal, setActiveProposal] = useState<RepairProposal | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [repairedFile, setRepairedFile] = useState<File | null>(null);
  const [repairedDuration, setRepairedDuration] = useState<number | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [repairedUrl, setRepairedUrl] = useState<string | null>(null);
  const originalContextRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!previewBlob || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  useEffect(() => {
    if (!repairedFile || typeof URL.createObjectURL !== "function") {
      setRepairedUrl(null);
      return;
    }
    const url = URL.createObjectURL(repairedFile);
    setRepairedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [repairedFile]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const approvedOperations = useMemo(
    () => report.repair_plan.proposals
      .filter((proposal) => approvedIds.has(proposal.proposal_id) && proposal.operation)
      .map((proposal) => proposal.operation as RepairOperation)
      .sort((left, right) => left.start_seconds - right.start_seconds),
    [approvedIds, report.repair_plan.proposals],
  );

  if (!report.repair_plan.proposals.length) return null;

  const openPreview = async (proposal: RepairProposal) => {
    if (!sourceFile || !proposal.operation) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setActiveProposal(proposal);
    setPreviewBlob(null);
    setPreviewError(null);
    setApplyError(null);
    setPreviewing(true);
    try {
      const result = await previewRepair(sourceFile, proposal.operation, { signal: controller.signal });
      if (!controller.signal.aborted) setPreviewBlob(result.blob);
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        setPreviewError(errorPresentation(error).message);
      }
    } finally {
      if (!controller.signal.aborted) setPreviewing(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const approveActive = () => {
    if (!activeProposal?.operation || !previewBlob) return;
    if (approvedOperations.some((operation) => rangesOverlap(operation, activeProposal.operation as RepairOperation))) {
      setPreviewError("This repair overlaps another approved range. Keep only one of the overlapping repairs.");
      return;
    }
    clearRenderedOutput();
    setApprovedIds((current) => new Set(current).add(activeProposal.proposal_id));
    closePreview();
  };

  const closePreview = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setActiveProposal(null);
    setPreviewBlob(null);
    setPreviewError(null);
    setPreviewing(false);
  };

  const applyApproved = async () => {
    if (!sourceFile || !approvedOperations.length) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setApplyError(null);
    setApplying(true);
    try {
      const result = await applyRepairs(sourceFile, approvedOperations, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const name = repairedFilename(sourceFile.name);
      setRepairedFile(new File([result.blob], name, { type: "video/mp4" }));
      setRepairedDuration(result.outputDurationSeconds);
      setAppliedCount(approvedOperations.length);
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        setApplyError(errorPresentation(error).message);
      }
    } finally {
      if (!controller.signal.aborted) setApplying(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const plan = report.repair_plan;
  function clearRenderedOutput() {
    setRepairedFile(null);
    setRepairedDuration(null);
    setAppliedCount(0);
  }
  return (
    <section className="repair-panel" aria-labelledby="repair-heading">
      <header className="repair-header">
        <div>
          <h2 id="repair-heading">Repair queue</h2>
          <p>
            {plan.safe_count} safe {plural(plan.safe_count, "repair")} · {plan.preview_required_count} to preview · {plan.human_only_count} need your judgment
          </p>
        </div>
        {approvedOperations.length > 0 && (
          <button className="primary-button" type="button" disabled={applying || !sourceFile} onClick={() => void applyApproved()}>
            <Scissors aria-hidden="true" /> {applying ? "Rendering repaired video…" : `Apply ${approvedOperations.length} approved ${plural(approvedOperations.length, "repair")}`}
          </button>
        )}
      </header>

      <div className="repair-list">
        {plan.proposals.map((proposal) => {
          const approved = approvedIds.has(proposal.proposal_id);
          return (
            <article className="repair-item" key={proposal.proposal_id}>
              <div className={`repair-class repair-${proposal.repairability.toLowerCase()}`}>
                {proposal.repairability === "SAFE" ? "Safe repair" : proposal.repairability === "PREVIEW_REQUIRED" ? "Preview required" : "Your judgment"}
              </div>
              <div className="repair-copy">
                <h3>{proposal.finding_title}</h3>
                {proposal.start_seconds !== null && (
                  <button className="repair-timecode" type="button" onClick={() => onSeek(proposal.start_seconds as number)}>
                    {formatRange(proposal)}
                  </button>
                )}
                <p>{proposal.explanation}</p>
                {proposal.expected_duration_change_seconds !== null && (
                  <small>Video duration will be reduced by approximately {Math.abs(proposal.expected_duration_change_seconds).toFixed(1)} seconds.</small>
                )}
                {proposal.original_start_seconds !== null && proposal.original_end_seconds !== null && (
                  <small>Original/reference interval: {formatTimecode(proposal.original_start_seconds)}–{formatTimecode(proposal.original_end_seconds)}</small>
                )}
              </div>
              <div className="repair-actions">
                {proposal.operation ? (
                  approved ? (
                    <button className="secondary-button" type="button" onClick={() => {
                      clearRenderedOutput();
                      setApprovedIds((current) => {
                        const next = new Set(current);
                        next.delete(proposal.proposal_id);
                        return next;
                      });
                    }}>
                      <RotateCcw aria-hidden="true" /> Remove approval
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" disabled={!sourceFile} onClick={() => void openPreview(proposal)}>
                      <Play aria-hidden="true" /> Preview repair
                    </button>
                  )
                ) : proposal.start_seconds !== null ? (
                  <button className="secondary-button" type="button" onClick={() => onSeek(proposal.start_seconds as number)}>
                    <Film aria-hidden="true" /> Review moment
                  </button>
                ) : null}
                {approved && <span className="approved-label"><Check aria-hidden="true" /> Approved</span>}
              </div>
            </article>
          );
        })}
      </div>

      {activeProposal?.operation && (
        <section className="repair-preview" aria-labelledby="repair-preview-title">
          <header>
            <div>
              <h3 id="repair-preview-title">Preview proposed repair</h3>
              <p>Remove {formatRange(activeProposal)} before rendering the full corrected video.</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close repair preview" onClick={closePreview}><X aria-hidden="true" /></button>
          </header>
          <div className="repair-comparison">
            <div>
              <strong>Original context</strong>
              {originalPreviewUrl ? (
                <video
                  ref={originalContextRef}
                  src={originalPreviewUrl}
                  controls
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (originalContextRef.current) originalContextRef.current.currentTime = Math.max(0, activeProposal.operation!.start_seconds - 4);
                  }}
                />
              ) : <p>Local preview is unavailable.</p>}
            </div>
            <div>
              <strong>Proposed repair</strong>
              {previewing && <p role="status">Rendering a short repaired context…</p>}
              {previewError && <p className="repair-error" role="alert">{previewError}</p>}
              {previewUrl && <video data-testid="repair-preview-video" src={previewUrl} controls preload="metadata" />}
            </div>
          </div>
          <div className="repair-preview-actions">
            <button className="primary-button" type="button" disabled={!previewBlob || previewing} onClick={approveActive}>Approve repair</button>
            <button className="secondary-button" type="button" onClick={closePreview}>Keep original</button>
          </div>
        </section>
      )}

      {applyError && <p className="repair-error apply-error" role="alert">{applyError}</p>}
      {repairedFile && repairedUrl && (
        <section className="repaired-output" aria-labelledby="repaired-output-title">
          <div>
            <h3 id="repaired-output-title">Repaired video</h3>
            <p>Repaired export created with {appliedCount} {plural(appliedCount, "repair")} applied.</p>
            <small>
              Original: {formatDuration(report.media.duration_seconds)} · Repaired: {formatDuration(repairedDuration)}
            </small>
          </div>
          <video data-testid="repaired-video" src={repairedUrl} controls preload="metadata" />
          <a className="primary-button download-repair" href={repairedUrl} download={repairedFile.name}>
            <Download aria-hidden="true" /> Download repaired video
          </a>
        </section>
      )}
    </section>
  );
}

function rangesOverlap(left: RepairOperation, right: RepairOperation): boolean {
  return left.start_seconds < right.end_seconds && right.start_seconds < left.end_seconds;
}

function repairedFilename(original: string): string {
  const stem = original.replace(/\.[^.]+$/, "") || "video";
  return `${stem}.repaired.mp4`;
}

function formatRange(proposal: RepairProposal): string {
  if (proposal.start_seconds === null) return "";
  return proposal.end_seconds === null
    ? formatTimecode(proposal.start_seconds)
    : `${formatTimecode(proposal.start_seconds)}–${formatTimecode(proposal.end_seconds)}`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
