import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Film,
  Headphones,
  MonitorPlay,
  ScanLine,
  Tag,
} from "lucide-react";
import type { Finding, FindingStatus, PreflightReport } from "../types/preflight";
import {
  findingCategory,
  findingTitle,
  formatBytes,
  formatDuration,
  formatInterval,
} from "../utils/format";

interface ResultsViewProps {
  report: PreflightReport;
  filename?: string;
  previewUrl?: string | null;
}

const verdictCopy: Record<FindingStatus, { label: string; description: string }> = {
  READY: { label: "Ready", description: "No issues requiring review were found." },
  NEEDS_REVIEW: { label: "Needs review", description: "Review the findings before you publish." },
  BLOCKED: { label: "Blocked", description: "Resolve the critical finding before you publish." },
};

const categoryIcons = {
  video: Film,
  audio: Headphones,
  package: Tag,
  captions: ScanLine,
  ai: ScanLine,
};

export function ResultsView({
  report,
  filename = "creator-export-final.mp4",
  previewUrl,
}: ResultsViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const categories = useMemo(
    () => Array.from(new Set(report.findings.map(findingCategory))),
    [report.findings],
  );
  const [activeCategory, setActiveCategory] = useState("all");
  const selectedCategory =
    activeCategory === "all" || categories.includes(activeCategory) ? activeCategory : "all";
  const filteredFindings = report.findings.filter(
    (finding) => selectedCategory === "all" || findingCategory(finding) === selectedCategory,
  );

  const seekTo = (finding: Finding) => {
    if (finding.timestamp_start_seconds === null || !videoRef.current) return;
    videoRef.current.currentTime = finding.timestamp_start_seconds;
    videoRef.current.focus({ preventScroll: true });
  };

  return (
    <main className="results page-frame" data-testid="result-state">
      <header className="result-overview">
        <div className="file-identity">
          <h1 title={filename}>{filename}</h1>
          <p>{mediaSummary(report)}</p>
        </div>
        <div className={`result-status verdict-${report.verdict.toLowerCase()}`}>
          <VerdictIcon verdict={report.verdict} />
          <div>
            <h2>{verdictCopy[report.verdict].label}</h2>
            <p>{verdictCopy[report.verdict].description}</p>
          </div>
        </div>
        <p className="result-counts" aria-label="Scan counts">
          <strong>{report.passed_check_count}</strong> passed
          <span aria-hidden="true">·</span>
          <strong>{report.warning_count}</strong> warnings
          <span aria-hidden="true">·</span>
          <strong>{report.critical_count}</strong> critical
        </p>
      </header>

      <div className="review-workspace">
        <section className="media-review" aria-label="Video review">
          <div className="video-frame">
            {previewUrl ? (
              <video ref={videoRef} data-testid="preview-video" src={previewUrl} controls preload="metadata" />
            ) : (
              <div className="video-placeholder">
                <MonitorPlay aria-hidden="true" />
                <strong>No local preview selected</strong>
                <span>Start a new scan with a local video to enable seeking.</span>
              </div>
            )}
          </div>

          <FindingsTimeline
            findings={report.findings}
            duration={report.media.duration_seconds}
            onSeek={seekTo}
          />
          <CheckDetails report={report} />
        </section>

        <section className="findings-panel" aria-labelledby="findings-title">
          <div className="findings-header">
            <h2 id="findings-title">Findings</h2>
            <span>{filteredFindings.length} of {report.findings.length}</span>
          </div>

          {categories.length > 0 && (
            <div className="filters" aria-label="Filter findings by category">
              <button
                type="button"
                className={selectedCategory === "all" ? "is-active" : ""}
                aria-pressed={selectedCategory === "all"}
                onClick={() => setActiveCategory("all")}
              >
                All <span>{report.findings.length}</span>
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={selectedCategory === category ? "is-active" : ""}
                  aria-pressed={selectedCategory === category}
                  onClick={() => setActiveCategory(category)}
                >
                  {capitalize(category)}
                  <span>{report.findings.filter((finding) => findingCategory(finding) === category).length}</span>
                </button>
              ))}
            </div>
          )}

          {filteredFindings.length ? (
            <div className="finding-list">
              {filteredFindings.map((finding) => (
                <FindingItem
                  key={`${finding.code}-${finding.timestamp_start_seconds ?? "global"}`}
                  finding={finding}
                  onSeek={seekTo}
                />
              ))}
            </div>
          ) : (
            <div className="empty-findings">
              <CheckCircle2 aria-hidden="true" />
              <h3>No findings requiring review</h3>
              <p>The checks in this report completed without warnings or critical issues.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function VerdictIcon({ verdict }: { verdict: FindingStatus }) {
  const Icon = verdict === "READY" ? CheckCircle2 : verdict === "BLOCKED" ? AlertCircle : AlertTriangle;
  return <Icon className="verdict-icon" aria-hidden="true" />;
}

function FindingsTimeline({ findings, duration, onSeek }: {
  findings: Finding[];
  duration: number | null;
  onSeek: (finding: Finding) => void;
}) {
  const timestamped = findings.filter(
    (finding) => finding.timestamp_start_seconds !== null && duration !== null && duration > 0,
  );
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="visually-hidden">Findings timeline</h2>
      <div className="timeline-ruler" aria-hidden="true">
        <span>0:00</span>
        <span>{formatDuration(duration ? duration / 2 : null)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
      <div className="timeline-track">
        {timestamped.map((finding, index) => {
          const start = finding.timestamp_start_seconds ?? 0;
          const left = duration ? Math.min(100, Math.max(0, (start / duration) * 100)) : 0;
          return (
            <button
              type="button"
              key={`${finding.code}-${start}`}
              className={`timeline-marker marker-${findingCategory(finding)} severity-${finding.severity}`}
              style={{ left: `${left}%`, top: `${8 + (index % 3) * 15}px` }}
              onClick={() => onSeek(finding)}
              aria-label={`Seek to ${findingTitle(finding)} at ${formatInterval(finding)}`}
              data-tooltip={`${findingTitle(finding)} · ${formatInterval(finding)}`}
            >
              <span />
            </button>
          );
        })}
      </div>
      <p className="timeline-caption">{timestamped.length} timed {timestamped.length === 1 ? "finding" : "findings"}</p>
    </section>
  );
}

function CheckDetails({ report }: { report: PreflightReport }) {
  return (
    <details className="check-details">
      <summary>
        <span>{report.checks_run_count} checks run · {report.passed_check_count} passed</span>
        <span>View details <ChevronDown aria-hidden="true" /></span>
      </summary>
      <ul>
        {report.checks.map((check) => (
          <li key={check.check_id} className={check.passed ? "is-pass" : "is-flagged"}>
            {check.passed ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            <span>{humanizeCheck(check.check_id)}</span>
            <small>{check.passed ? "Passed" : "Review"}</small>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FindingItem({ finding, onSeek }: { finding: Finding; onSeek: (finding: Finding) => void }) {
  const category = findingCategory(finding);
  const CategoryIcon = categoryIcons[category as keyof typeof categoryIcons] ?? ScanLine;
  const interval = formatInterval(finding);
  const severityText = finding.status === "BLOCKED" ? "Critical finding" : "Warning";
  return (
    <article className={`finding-item severity-${finding.severity}`} data-category={category}>
      <span className="finding-severity" title={severityText}>
        {finding.status === "BLOCKED" ? <AlertCircle aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <span className="visually-hidden">{severityText}:</span>
      </span>
      <div className="finding-content">
        <div className="finding-title-row">
          <h3>{findingTitle(finding)}</h3>
          {interval ? (
            <button type="button" className="timecode-button" onClick={() => onSeek(finding)}>
              <Clock3 aria-hidden="true" /> {interval}
            </button>
          ) : (
            <span className="finding-category"><CategoryIcon aria-hidden="true" />{capitalize(category)}</span>
          )}
        </div>
        <p className="finding-message">{finding.message}</p>
        {finding.suggestion && <p className="finding-suggestion">{finding.suggestion}</p>}
        <EvidenceDetails finding={finding} />
      </div>
    </article>
  );
}

function EvidenceDetails({ finding }: { finding: Finding }) {
  const evidence = evidenceEntries(finding);
  if (!evidence.length) return null;
  return (
    <details className="evidence-details">
      <summary>Technical details <ChevronDown aria-hidden="true" /></summary>
      <dl>
        {evidence.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </details>
  );
}

function evidenceEntries(finding: Finding): Array<[string, string]> {
  const details = finding.details;
  if (!details) return [];
  const evidence: Array<[string, string]> = [];
  if (typeof details.duration_seconds === "number") evidence.push(["Duration", `${details.duration_seconds.toFixed(2)} sec`]);
  if (typeof details.minimum_duration_seconds === "number") evidence.push(["Warning threshold", `${details.minimum_duration_seconds.toFixed(2)} sec`]);
  if (typeof details.measured_peak_dbfs === "number") evidence.push(["Measured peak", `${details.measured_peak_dbfs.toFixed(1)} dBFS`]);
  if (typeof details.warning_threshold_dbfs === "number") evidence.push(["Warning threshold", `${details.warning_threshold_dbfs.toFixed(1)} dBFS`]);
  if (typeof details.near_full_scale_sample_fraction === "number") evidence.push(["Near-full-scale samples", `${(details.near_full_scale_sample_fraction * 100).toFixed(2)}%`]);
  if (typeof details.minimum_near_full_scale_sample_fraction === "number") evidence.push(["Sample-density threshold", `${(details.minimum_near_full_scale_sample_fraction * 100).toFixed(2)}%`]);
  if (typeof details.character_count === "number") evidence.push(["Title length", `${details.character_count} characters`]);
  if (typeof details.maximum_recommended_length === "number") evidence.push(["Recommended maximum", `${details.maximum_recommended_length} characters`]);
  if (typeof details.actual_height === "number") evidence.push(["Actual height", `${details.actual_height}px`]);
  if (typeof details.minimum_height === "number") evidence.push(["Minimum height", `${details.minimum_height}px`]);
  if (typeof details.maximum_uncovered_gap_seconds === "number") evidence.push(["Gap threshold", `${details.maximum_uncovered_gap_seconds.toFixed(2)} sec`]);
  if (typeof details.boundary_tolerance_seconds === "number") evidence.push(["Boundary tolerance", `${details.boundary_tolerance_seconds.toFixed(2)} sec`]);
  if (typeof details.media_duration_seconds === "number") evidence.push(["Media duration", `${details.media_duration_seconds.toFixed(2)} sec`]);
  if (typeof details.confidence === "number") evidence.push(["AI confidence", `${Math.round(details.confidence * 100)}%`]);
  if (typeof details.provider === "string") evidence.push(["AI provider", details.provider]);
  if (typeof details.model === "string") evidence.push(["AI model", details.model]);
  return evidence;
}

function mediaSummary(report: PreflightReport): string {
  const media = report.media;
  const frame = media.width !== null && media.height !== null ? `${media.width} × ${media.height}` : "Unknown size";
  const video = formatCodec(media.video_codec);
  const audio = formatCodec(media.audio_codec);
  const frameRate = media.frame_rate !== null ? `${media.frame_rate} fps` : "Unknown frame rate";
  const duration = media.duration_seconds !== null && media.duration_seconds < 60
    ? `${Math.round(media.duration_seconds)} sec`
    : formatDuration(media.duration_seconds);
  return `${frame} · ${video} · ${audio} · ${frameRate} · ${duration} · ${formatBytes(media.file_size_bytes)}`;
}

function formatCodec(codec: string | null): string {
  if (!codec) return "No stream";
  if (codec.toLowerCase() === "h264") return "H.264";
  if (codec.toLowerCase() === "h265" || codec.toLowerCase() === "hevc") return "H.265";
  return codec.toUpperCase();
}

function humanizeCheck(value: string): string {
  return value.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}

function capitalize(value: string): string {
  if (value === "ai") return "AI";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
