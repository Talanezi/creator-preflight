import { useRef, useState } from "react";
import {
  Captions,
  FileVideo2,
  Play,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { formatBytes } from "../utils/format";

export interface ScanInputs {
  video: File | null;
  title: string;
  description: string;
  captions: File | null;
}

interface ScanFormProps {
  inputs: ScanInputs;
  onChange: (inputs: ScanInputs) => void;
  onRun: () => void;
}

const TITLE_GUIDANCE = 100;

export function ScanForm({ inputs, onChange, onRun }: ScanFormProps) {
  const videoInput = useRef<HTMLInputElement>(null);
  const captionInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const selectVideo = (file?: File) => {
    if (file) onChange({ ...inputs, video: file });
  };

  return (
    <main className="new-scan page-frame" data-testid="input-state">
      <section className="workspace-intro">
        <div>
          <p className="eyebrow">New scan</p>
          <h1>Preflight a publishing package</h1>
          <p>
            Review media health, audio, metadata, and publishing requirements
            before your upload leaves the edit bay.
          </p>
        </div>
        <div className="workflow-key" aria-label="Workflow summary">
          <span><strong>01</strong> Add package</span>
          <span><strong>02</strong> Run checks</span>
          <span><strong>03</strong> Review evidence</span>
        </div>
      </section>

      <div className="scan-layout">
        <section className="panel upload-panel" aria-labelledby="video-heading">
          <div className="section-heading">
            <span className="section-index">01</span>
            <div>
              <h2 id="video-heading">Video input</h2>
              <p>The finished export you intend to publish.</p>
            </div>
          </div>

          <input
            ref={videoInput}
            className="visually-hidden"
            type="file"
            accept="video/*,.mp4,.mov,.mkv,.webm"
            aria-label="Select video file"
            onChange={(event) => selectVideo(event.target.files?.[0])}
          />

          {inputs.video ? (
            <div className="selected-file" data-testid="selected-video">
              <div className="file-icon"><FileVideo2 aria-hidden="true" /></div>
              <div className="file-copy">
                <strong title={inputs.video.name}>{inputs.video.name}</strong>
                <span>{formatBytes(inputs.video.size)} · Local preview available</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Remove selected video"
                onClick={() => onChange({ ...inputs, video: null })}
              >
                <X aria-hidden="true" />
              </button>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => videoInput.current?.click()}
              >
                <RefreshCw aria-hidden="true" /> Change
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`drop-zone${dragging ? " is-dragging" : ""}`}
              onClick={() => videoInput.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                selectVideo(event.dataTransfer.files[0]);
              }}
            >
              <span className="drop-icon"><UploadCloud aria-hidden="true" /></span>
              <strong>Drop your finished video here</strong>
              <span>or click to choose a local file</span>
              <small>MP4, MOV, MKV, or WebM · analyzed by your local instance</small>
            </button>
          )}
        </section>

        <section className="panel package-panel" aria-labelledby="package-heading">
          <div className="section-heading">
            <span className="section-index">02</span>
            <div>
              <h2 id="package-heading">Publishing package</h2>
              <p>Metadata that will travel with the video.</p>
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label htmlFor="scan-title">Title</label>
              <span className={inputs.title.length > 85 ? "count is-near-limit" : "count"}>
                {inputs.title.length} / {TITLE_GUIDANCE}
              </span>
            </div>
            <input
              id="scan-title"
              value={inputs.title}
              placeholder="The title viewers will see"
              onChange={(event) => onChange({ ...inputs, title: event.target.value })}
            />
            <p className="field-hint">Recommendation only; final rules come from your scan profile.</p>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label htmlFor="scan-description">Description</label>
              <span className="count">{inputs.description.length} characters</span>
            </div>
            <textarea
              id="scan-description"
              rows={8}
              value={inputs.description}
              placeholder={"Describe the video, add links, and list chapters…\n\n00:00 Introduction"}
              onChange={(event) =>
                onChange({ ...inputs, description: event.target.value })
              }
            />
          </div>

          <div className="field-group captions-field">
            <div>
              <span className="field-label"><Captions aria-hidden="true" /> Captions</span>
              <p>Optional · presence only in the current product milestone</p>
            </div>
            <input
              ref={captionInput}
              className="visually-hidden"
              type="file"
              accept=".srt,.vtt"
              aria-label="Select optional captions file"
              onChange={(event) =>
                onChange({ ...inputs, captions: event.target.files?.[0] ?? null })
              }
            />
            {inputs.captions ? (
              <div className="caption-selection">
                <span title={inputs.captions.name}>{inputs.captions.name}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove captions file"
                  onClick={() => onChange({ ...inputs, captions: null })}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => captionInput.current?.click()}
              >
                Add captions
              </button>
            )}
          </div>

          <button
            type="button"
            className="primary-button run-button"
            disabled={!inputs.video}
            onClick={onRun}
          >
            <Play aria-hidden="true" fill="currentColor" /> Run Preflight
          </button>
        </section>
      </div>
    </main>
  );
}
