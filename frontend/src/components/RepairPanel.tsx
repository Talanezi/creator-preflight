import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Film, Play, RotateCcw, Scissors, X } from "lucide-react";
import { applyRepairs, errorPresentation, isAbortError, previewRepair, renderReviewReel, verifyRepair } from "../api/preflight";
import type { PreflightReport, RepairOperation, RepairProposal, ReviewMode, VerificationReport } from "../types/preflight";
import { formatDuration, formatTimecode } from "../utils/format";

interface RepairPanelProps {
  report: PreflightReport;
  sourceFile: File | null;
  originalPreviewUrl?: string | null;
  onSeek: (seconds: number) => void;
  packageInput?: { title: string; description: string; captions?: File | null; thumbnail?: File | null; reviewMode: ReviewMode };
}

type HumanDisposition = "PENDING" | "ACCEPTED_INTENTIONAL" | "NEEDS_CHANGE";

export function RepairPanel({ report, sourceFile, originalPreviewUrl, onSeek, packageInput }: RepairPanelProps) {
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
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [reviewReel, setReviewReel] = useState<File | null>(null);
  const [reviewReelUrl, setReviewReelUrl] = useState<string | null>(null);
  const [humanDispositions, setHumanDispositions] = useState<Record<string, HumanDisposition>>({});
  const originalContextRef = useRef<HTMLVideoElement>(null);
  const repairedVideoRef = useRef<HTMLVideoElement>(null);
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

  useEffect(() => {
    if (!reviewReel || typeof URL.createObjectURL !== "function") {
      setReviewReelUrl(null);
      return;
    }
    const url = URL.createObjectURL(reviewReel);
    setReviewReelUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reviewReel]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    setHumanDispositions({});
  }, [report]);

  const approvedOperations = useMemo(
    () => report.repair_plan.proposals
      .filter((proposal) => approvedIds.has(proposal.proposal_id) && proposal.operation)
      .map((proposal) => proposal.operation as RepairOperation)
      .sort((left, right) => left.start_seconds - right.start_seconds),
    [approvedIds, report.repair_plan.proposals],
  );

  const humanReview = useMemo(() => {
    const proposals = report.repair_plan.proposals.filter((proposal) => proposal.repairability === "HUMAN_ONLY");
    const accepted = proposals.filter((proposal) => humanDispositions[proposal.proposal_id] === "ACCEPTED_INTENTIONAL").length;
    const needsChange = proposals.filter((proposal) => humanDispositions[proposal.proposal_id] === "NEEDS_CHANGE").length;
    return { total: proposals.length, accepted, needsChange, pending: proposals.length - accepted - needsChange };
  }, [humanDispositions, report.repair_plan.proposals]);

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
      const repaired = new File([result.blob], name, { type: "video/mp4" });
      setRepairedFile(repaired);
      setRepairedDuration(result.outputDurationSeconds);
      setAppliedCount(approvedOperations.length);
      setApplying(false);
      setVerifying(true);
      setVerification(null);
      setVerificationError(null);
      setReviewReel(null);
      try {
        const verified = await verifyRepair({
          originalVideo: sourceFile,
          repairedVideo: repaired,
          operations: approvedOperations,
          originalReport: report,
          title: packageInput?.title ?? "",
          description: packageInput?.description ?? "",
          reviewMode: packageInput?.reviewMode ?? report.review_mode,
          captions: packageInput?.captions,
          thumbnail: packageInput?.thumbnail,
        }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setVerification(verified);
        if (verified.review_reel_available) {
          const reel = await renderReviewReel(repaired, verified.review_reel_manifest, { signal: controller.signal });
          if (!controller.signal.aborted) setReviewReel(new File([reel.blob], "creator-preflight.review-reel.mp4", { type: "video/mp4" }));
        }
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted) setVerificationError(errorPresentation(error).message);
      } finally {
        if (!controller.signal.aborted) setVerifying(false);
      }
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
    setVerification(null);
    setVerificationError(null);
    setReviewReel(null);
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

      {humanReview.total > 0 && (
        <section className="human-review-summary" aria-labelledby="human-review-heading">
          <div>
            <h3 id="human-review-heading">Human review</h3>
            <p>{humanReview.total} {plural(humanReview.total, "finding")} require your judgment.</p>
          </div>
          <p className="human-review-counts" aria-label="Human review counts">
            <strong>{humanReview.accepted}</strong> accepted · <strong>{humanReview.needsChange}</strong> {humanReview.needsChange === 1 ? "needs" : "need"} change · <strong>{humanReview.pending}</strong> pending
          </p>
          {humanReview.pending === 0 && (
            <p className="human-review-complete">
              <Check aria-hidden="true" /> Human review is complete.{humanReview.needsChange > 0 ? ` ${humanReview.needsChange} ${plural(humanReview.needsChange, "issue")} still ${humanReview.needsChange === 1 ? "needs" : "need"} editing.` : " No items are marked as needing a change."}
            </p>
          )}
        </section>
      )}

      <div className="repair-list">
        {plan.proposals.map((proposal) => {
          const approved = approvedIds.has(proposal.proposal_id);
          const humanDisposition = humanDispositions[proposal.proposal_id] ?? "PENDING";
          const setHumanDisposition = (disposition: HumanDisposition) => {
            setHumanDispositions((current) => ({ ...current, [proposal.proposal_id]: disposition }));
          };
          return (
            <article className={`repair-item${proposal.repairability === "HUMAN_ONLY" ? ` human-${humanDisposition.toLowerCase()}` : ""}`} key={proposal.proposal_id}>
              <div className={`repair-class repair-${proposal.repairability.toLowerCase()}`}>
                {proposal.repairability === "SAFE" ? "Safe repair" : proposal.repairability === "PREVIEW_REQUIRED" ? "Preview required" : humanDisposition === "ACCEPTED_INTENTIONAL" ? "Reviewed — accepted" : humanDisposition === "NEEDS_CHANGE" ? "Needs change" : "Your judgment"}
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
                {proposal.repairability === "HUMAN_ONLY" && humanDisposition === "ACCEPTED_INTENTIONAL" && (
                  <small className="human-decision-copy">Marked intentional by you.</small>
                )}
                {proposal.repairability === "HUMAN_ONLY" && humanDisposition === "NEEDS_CHANGE" && (
                  <small className="human-decision-copy">You marked this as something that still needs editing.</small>
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
                ) : proposal.repairability === "HUMAN_ONLY" ? (
                  <>
                    {proposal.start_seconds !== null && humanDisposition !== "ACCEPTED_INTENTIONAL" && (
                      <button className="secondary-button" type="button" onClick={() => onSeek(proposal.start_seconds as number)}>
                        <Film aria-hidden="true" /> {humanDisposition === "NEEDS_CHANGE" ? "Review again" : "Review moment"}
                      </button>
                    )}
                    {humanDisposition === "PENDING" ? (
                      <>
                        <button className="secondary-button" type="button" onClick={() => setHumanDisposition("ACCEPTED_INTENTIONAL")}>Looks intentional</button>
                        <button className="secondary-button" type="button" onClick={() => setHumanDisposition("NEEDS_CHANGE")}>Needs a change</button>
                      </>
                    ) : (
                      <button className="secondary-button" type="button" onClick={() => setHumanDisposition("PENDING")}>
                        <RotateCcw aria-hidden="true" /> Change decision
                      </button>
                    )}
                  </>
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
      {verifying && <p className="verification-progress" role="status">Verifying repair… Re-scanning the repaired export and checking for unexpected visual changes.</p>}
      {verificationError && <p className="repair-error apply-error" role="alert">Verification could not finish: {verificationError} The repaired video remains available.</p>}
      {repairedFile && repairedUrl && (
        <section className="repaired-output" aria-labelledby="repaired-output-title">
          <div>
            <h3 id="repaired-output-title">{verification?.status === "VERIFIED" ? "Repair verified" : verification?.status === "NEEDS_REVIEW" ? "Repair needs review" : verification?.status === "INCOMPLETE" ? "Verification incomplete" : "Repaired video"}</h3>
            <p>{verification ? `${appliedCount} ${plural(appliedCount, "repair")} applied · ${verification.resolved.length} resolved · ${verification.remaining.length} remaining · ${verification.new.length} new · ${verification.unexpected_changes.length} unexpected` : `Repaired export created with ${appliedCount} ${plural(appliedCount, "repair")} applied.`}</p>
            <small>
              Original: {formatDuration(report.media.duration_seconds)} · Repaired: {formatDuration(repairedDuration)}
            </small>
          </div>
          {verification && <VerificationItems report={verification} onSeek={(seconds) => { if (repairedVideoRef.current) { repairedVideoRef.current.currentTime = seconds; repairedVideoRef.current.focus(); } }} />}
          <video ref={repairedVideoRef} data-testid="repaired-video" src={repairedUrl} controls preload="metadata" />
          <a className="primary-button download-repair" href={repairedUrl} download={repairedFile.name}>
            <Download aria-hidden="true" /> Download repaired video
          </a>
          {reviewReel && reviewReelUrl && verification && (
            <section className="review-reel" aria-labelledby="review-reel-title">
              <h4 id="review-reel-title">Review Reel</h4>
              <p>{formatDuration(verification.review_reel_manifest.total_duration_seconds)} of repair and review moments.</p>
              <video data-testid="review-reel-video" src={reviewReelUrl} controls preload="metadata" />
              <ol>{verification.review_reel_manifest.entries.map((entry, index) => <li key={`${entry.reel_start_seconds}-${index}`}><strong>{formatTimecode(entry.reel_start_seconds)}–{formatTimecode(entry.reel_end_seconds)}</strong> {entry.reason}</li>)}</ol>
              <a className="secondary-button" href={reviewReelUrl} download={reviewReel.name}><Download aria-hidden="true" /> Download Review Reel</a>
            </section>
          )}
        </section>
      )}
    </section>
  );
}

function VerificationItems({ report, onSeek }: { report: VerificationReport; onSeek: (seconds: number) => void }) {
  return <div className="verification-items">
    {!report.unexpected_changes.length && <p><Check aria-hidden="true" /> No unexpected visual changes detected.</p>}
    {[...report.resolved, ...report.remaining, ...report.new].map((item, index) => {
      const finding = item.repaired_finding ?? item.original_finding;
      const time = item.repaired_finding?.timestamp_start_seconds ?? item.expected_repaired_start_seconds;
      return <article key={`${item.status}-${finding?.code ?? index}-${index}`}>
        <strong>{item.status === "RESOLVED" ? "Resolved" : item.status === "REMAINING" ? "Still needs attention" : "New after repair"}: {finding?.details?.title ? String(finding.details.title) : finding?.code}</strong>
        <p>{item.explanation}</p>
        {time !== null && time !== undefined && <button className="repair-timecode" type="button" onClick={() => onSeek(time)}>{formatTimecode(time)}</button>}
      </article>;
    })}
    {report.unexpected_changes.map((change) => <article key={`${change.start_seconds}-${change.end_seconds}`}><strong>Unexpected change</strong><p>This region changed materially outside the approved edit.</p><button className="repair-timecode" type="button" onClick={() => onSeek(change.start_seconds)}>{formatTimecode(change.start_seconds)}–{formatTimecode(change.end_seconds)}</button></article>)}
  </div>;
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
