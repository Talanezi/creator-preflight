import { useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Film,
  Gauge,
  Headphones,
  MonitorPlay,
  RotateCcw,
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
  previewUrl?: string | null;
  onNewScan: () => void;
}

const verdictCopy: Record<FindingStatus, { label: string; description: string }> = {
  READY: {
    label: "Ready",
    description: "No issues requiring review were found.",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    description: "The scan completed. Review the evidence below before publishing.",
  },
  BLOCKED: {
    label: "Blocked",
    description: "The scan completed, but critical package findings require attention.",
  },
};

const categoryIcons = {
  video: Film,
  audio: Headphones,
  package: Tag,
  captions: ScanLine,
};

export function ResultsView({ report, previewUrl, onNewScan }: ResultsViewProps) {
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
      <section className={`verdict-banner verdict-${report.verdict.toLowerCase()}`}>
        <div className="verdict-main">
          <VerdictIcon verdict={report.verdict} />
          <div>
            <p className="eyebrow">Preflight complete</p>
            <h1>{verdictCopy[report.verdict].label}</h1>
            <p>{verdictCopy[report.verdict].description}</p>
          </div>
        </div>
        <div className="verdict-stats" aria-label="Scan counts">
          <Stat value={report.passed_check_count} label="Passed" tone="pass" />
          <Stat value={report.warning_count} label="Warnings" tone="warning" />
          <Stat value={report.critical_count} label="Critical" tone="critical" />
        </div>
        <button type="button" className="secondary-button new-scan-button" onClick={onNewScan}>
          <RotateCcw aria-hidden="true" /> New scan
        </button>
      </section>

      <section className="media-strip" aria-label="Media summary">
        <MediaDatum
          label="Frame"
          value={
            report.media.width !== null && report.media.height !== null
              ? `${report.media.width} × ${report.media.height}`
              : "Unknown"
          }
        />
        <MediaDatum label="Video" value={(report.media.video_codec ?? "None").toUpperCase()} />
        <MediaDatum label="Audio" value={(report.media.audio_codec ?? "None").toUpperCase()} />
        <MediaDatum
          label="Frame rate"
          value={report.media.frame_rate !== null ? `${report.media.frame_rate} fps` : "Unknown"}
        />
        <MediaDatum label="Duration" value={formatDuration(report.media.duration_seconds)} />
        <MediaDatum label="File size" value={formatBytes(report.media.file_size_bytes)} />
        <div className="scan-meta">
          <span>{report.checks_run_count} checks</span>
          <span>{report.scan_duration_seconds.toFixed(2)}s scan</span>
          <span>{report.configuration_profile} profile</span>
        </div>
      </section>

      <div className="results-grid">
        <section className="inspection-column">
          <div className="video-frame panel">
            <div className="video-toolbar">
              <div><CircleDot aria-hidden="true" /> Local preview</div>
              <span>{previewUrl ? "Selected browser file" : "No preview loaded"}</span>
            </div>
            {previewUrl ? (
              <video ref={videoRef} data-testid="preview-video" src={previewUrl} controls preload="metadata" />
            ) : (
              <div className="video-placeholder">
                <MonitorPlay aria-hidden="true" />
                <strong>Video preview unavailable in mock report</strong>
                <span>Select a local video on a new scan to enable click-to-seek.</span>
              </div>
            )}
          </div>

          <FindingsTimeline
            findings={report.findings}
            duration={report.media.duration_seconds}
            onSeek={seekTo}
          />

          <section className="check-summary panel">
            <div className="panel-title-row">
              <div><CheckCircle2 aria-hidden="true" /><h2>Check coverage</h2></div>
              <span>{report.passed_check_count} / {report.checks_run_count} passed</span>
            </div>
            <div className="check-grid">
              {report.checks.map((check) => (
                <div key={check.check_id} className={check.passed ? "check-chip is-pass" : "check-chip is-flagged"}>
                  {check.passed ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                  <span>{humanizeCheck(check.check_id)}</span>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className="findings-panel panel" aria-labelledby="findings-title">
          <div className="findings-header">
            <div>
              <p className="eyebrow">Evidence</p>
              <h2 id="findings-title">Findings</h2>
            </div>
            <span>{filteredFindings.length} shown</span>
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
                <FindingItem key={`${finding.code}-${finding.timestamp_start_seconds ?? "global"}`} finding={finding} onSeek={seekTo} />
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
  const Icon = verdict === "READY" ? CheckCircle2 : verdict === "BLOCKED" ? AlertOctagon : AlertTriangle;
  return <span className="verdict-icon"><Icon aria-hidden="true" /></span>;
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return <div className={`stat stat-${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function MediaDatum({ label, value }: { label: string; value: string }) {
  return <div className="media-datum"><span>{label}</span><strong>{value}</strong></div>;
}

function FindingsTimeline({
  findings,
  duration,
  onSeek,
}: {
  findings: Finding[];
  duration: number | null;
  onSeek: (finding: Finding) => void;
}) {
  const timestamped = findings.filter(
    (finding) => finding.timestamp_start_seconds !== null && duration !== null && duration > 0,
  );
  return (
    <section className="timeline-panel panel" aria-labelledby="timeline-title">
      <div className="panel-title-row">
        <div><Gauge aria-hidden="true" /><h2 id="timeline-title">Findings timeline</h2></div>
        <span>{timestamped.length} timed events</span>
      </div>
      <div className="timeline-ruler" aria-hidden="true">
        <span>0:00</span><span>{formatDuration(duration ? duration / 2 : null)}</span><span>{formatDuration(duration)}</span>
      </div>
      <div className="timeline-track">
        <div className="timeline-fill" />
        {timestamped.map((finding, index) => {
          const start = finding.timestamp_start_seconds ?? 0;
          const left = duration ? Math.min(100, Math.max(0, (start / duration) * 100)) : 0;
          return (
            <button
              type="button"
              key={`${finding.code}-${start}`}
              className={`timeline-marker marker-${findingCategory(finding)} severity-${finding.severity}`}
              style={{ left: `${left}%`, top: `${8 + (index % 3) * 18}px` }}
              onClick={() => onSeek(finding)}
              aria-label={`Seek to ${findingTitle(finding)} at ${formatInterval(finding)}`}
              title={`${findingTitle(finding)} · ${formatInterval(finding)}`}
              data-tooltip={`${findingTitle(finding)} · ${formatInterval(finding)}`}
            >
              <span />
            </button>
          );
        })}
      </div>
      <div className="timeline-legend"><span><i className="legend-video" /> Video</span><span><i className="legend-audio" /> Audio</span></div>
    </section>
  );
}

function FindingItem({ finding, onSeek }: { finding: Finding; onSeek: (finding: Finding) => void }) {
  const category = findingCategory(finding);
  const CategoryIcon = categoryIcons[category as keyof typeof categoryIcons] ?? ScanLine;
  const interval = formatInterval(finding);
  return (
    <article className={`finding-item severity-${finding.severity}`} data-category={category}>
      <div className="finding-topline">
        <span className="severity-label">
          {finding.status === "BLOCKED" ? <AlertOctagon aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {finding.status === "BLOCKED" ? "Critical" : "Warning"}
        </span>
        <span className="category-label"><CategoryIcon aria-hidden="true" />{capitalize(category)}</span>
      </div>
      <h3>{findingTitle(finding)}</h3>
      {interval ? (
        <button type="button" className="timecode-button" onClick={() => onSeek(finding)}>
          <Clock3 aria-hidden="true" /> {interval}
        </button>
      ) : (
        <span className="global-label">Package / global check</span>
      )}
      <p className="finding-message">{finding.message}</p>
      <Evidence finding={finding} />
      {finding.suggestion && <p className="suggestion"><strong>Next step</strong>{finding.suggestion}</p>}
    </article>
  );
}

function Evidence({ finding }: { finding: Finding }) {
  const details = finding.details;
  if (!details) return null;
  const evidence: string[] = [];
  if (typeof details.duration_seconds === "number") {
    evidence.push(`Duration ${details.duration_seconds.toFixed(2)}s`);
  }
  if (typeof details.minimum_duration_seconds === "number") {
    evidence.push(`Threshold ${details.minimum_duration_seconds.toFixed(2)}s`);
  }
  if (typeof details.measured_peak_dbfs === "number") {
    evidence.push(`Peak ${details.measured_peak_dbfs.toFixed(1)} dBFS`);
  }
  if (typeof details.warning_threshold_dbfs === "number") {
    evidence.push(`Warning at ${details.warning_threshold_dbfs.toFixed(1)} dBFS`);
  }
  if (typeof details.character_count === "number" && typeof details.maximum_recommended_length === "number") {
    evidence.push(`${details.character_count} characters`);
    evidence.push(`Recommended max ${details.maximum_recommended_length}`);
  }
  if (typeof details.actual_height === "number" && typeof details.minimum_height === "number") {
    evidence.push(`Actual ${details.actual_height}px`);
    evidence.push(`Minimum ${details.minimum_height}px`);
  }
  return evidence.length ? <div className="evidence-row">{evidence.map((item) => <span key={item}>{item}</span>)}</div> : null;
}

function humanizeCheck(value: string): string {
  return value.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
