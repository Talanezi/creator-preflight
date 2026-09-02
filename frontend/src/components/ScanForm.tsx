import { useRef, useState } from "react";
import { Captions, FileVideo2, Play, RefreshCw, Upload, X } from "lucide-react";
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
      <header className="page-intro">
        <h1>Check a finished video</h1>
        <p>Add the package you plan to publish. Creator Preflight reviews the media and its publishing details together.</p>
      </header>

      <form className="scan-surface" onSubmit={(event) => { event.preventDefault(); if (inputs.video) onRun(); }}>
        <section className="video-input-section" aria-labelledby="video-heading">
          <h2 id="video-heading">Video</h2>

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
              <FileVideo2 className="file-icon" aria-hidden="true" />
              <div className="file-copy">
                <strong title={inputs.video.name}>{inputs.video.name}</strong>
                <span>{formatBytes(inputs.video.size)} · ready to preview locally</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Remove selected video"
                onClick={() => {
                  if (videoInput.current) videoInput.current.value = "";
                  onChange({ ...inputs, video: null });
                }}
              >
                <X aria-hidden="true" />
              </button>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => {
                  if (videoInput.current) videoInput.current.value = "";
                  videoInput.current?.click();
                }}
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
              <Upload className="drop-icon" aria-hidden="true" />
              <strong>Choose a video or drop it here</strong>
              <span>MP4, MOV, MKV, or WebM</span>
              <small>The file stays on this Creator Preflight instance.</small>
            </button>
          )}
        </section>

        <section className="package-section" aria-labelledby="package-heading">
          <h2 id="package-heading">Publishing details</h2>

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
            <p className="field-hint">The configured scan profile determines the final limit.</p>
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
              <span className="field-label"><Captions aria-hidden="true" /> Captions <em>Optional</em></span>
              <p>Add an SRT or VTT file for timing, structure, and coverage checks.</p>
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
                  onClick={() => {
                    if (captionInput.current) captionInput.current.value = "";
                    onChange({ ...inputs, captions: null });
                  }}
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
            type="submit"
            className="primary-button run-button"
            disabled={!inputs.video}
          >
            <Play aria-hidden="true" fill="currentColor" /> Run Preflight
          </button>
        </section>
      </form>
    </main>
  );
}
