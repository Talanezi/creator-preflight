# Creator Preflight

**Review the finished upload before your audience does.**

Creator Preflight reviews a real finished creator video together with its title, description, captions, and optional thumbnail. It returns an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report, puts evidence at the original video timestamp, and lets the creator click a finding to seek directly to the moment that needs attention.

It combines four review layers:

- **Technical integrity** — deterministic FFmpeg/FFprobe checks for media structure, black sections, silence, frozen frames, suspicious near-full-scale audio density, and missing streams.
- **Promise Check** — optional Gemini review of whether the title and thumbnail match the finished video, plus when the advertised subject begins being substantively addressed.
- **Final Viewer Pass** — optional Gemini review for high-confidence internal inconsistencies such as narration/graphic conflicts, visible production placeholders, and accidental repetition.
- **Claim Review** — optional extraction of at most three important public factual claims, verified together with Google Search grounding. Only evidence-backed possible conflicts become warnings, and displayed links come from provider citation metadata.

Publishing rules also validate resolution, aspect ratio, title, description, URLs, chapters, and caption requirements. UTF-8 SRT and WebVTT files are parsed for timing, ordering, range, overlap, gaps, and merged coverage. Optional local Whisper can compare speech intervals with caption coverage.

FFmpeg analysis is deterministic media processing, not AI. The browser explicitly offers **Full Review** or **Local Checks Only**. Local Checks requires no API key and never sends media to Gemini. Full Review is opt-in, probabilistic review evidence: the backend sends the video and optional thumbnail to Google once per scan, keeps the API key server-side, and attempts remote cleanup. AI findings are review-only and never block publication by themselves.

## Quick start

Prerequisites:

- Python 3.10+
- FFmpeg and FFprobe on `PATH`
- Node.js and npm for the web interface

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install './backend[dev]'
cd frontend && npm install && cd ..
```

Run the network-free deterministic demo:

```sh
./scripts/run_demo.sh
```

It generates a 12-second local fixture and reports the known 2–5 second black section, 3–6 second silence, 7–10 second non-black freeze, a deliberately hard-limited audio warning, and one title recommendation. Expected result: `NEEDS_REVIEW`, 20 checks, 15 passed, 5 warnings, 0 critical.

Run the web application in two terminals:

```sh
.venv/bin/uvicorn creator_preflight.api:app --app-dir backend/src --reload --host 127.0.0.1 --port 8000
```

```sh
cd frontend
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. Vite proxies the multipart scan request to FastAPI. Backend upload copies are temporary and removed after each request.

The input screen shows the two review modes explicitly. Local Checks Only is available with the core installation. For Full Review, install and configure the optional Gemini dependency as described below; no special YAML profile is required for the browser workflow.

## Judge demo package

On macOS, generate the paired 60-second creator-style packages:

```sh
.venv/bin/python scripts/prepare_judge_demo.py
```

The command prints every generated and tracked input path. The defective cut contains a 12–15 second black export gap, a delayed title promise, a visible unfinished map placeholder, and a deliberately incorrect Apollo 11 date. The corrected cut removes those defects. Generated media stays under ignored `demo/generated/judge/`; no copyrighted media is used or committed.

See [`docs/DEMO.md`](docs/DEMO.md) for the 90–120 second judge sequence and [`docs/SUBMISSION.md`](docs/SUBMISSION.md) for factual Devpost draft material.

## Optional AI review

Install the isolated dependency:

```sh
.venv/bin/python -m pip install './backend[ai]'
```

Set `GEMINI_API_KEY` only in the backend process environment before starting FastAPI:

```sh
export GEMINI_API_KEY="your-server-side-key"
.venv/bin/uvicorn creator_preflight.api:app --app-dir backend/src --reload --host 127.0.0.1 --port 8000
```

The browser reads non-secret backend capabilities and enables Full Review when FFmpeg, the optional Gemini dependency, and the server-side key are available. Selecting Full Review enables Promise Check, Final Viewer Pass, and Claim Review for that request. Selecting Local Checks Only forcibly disables Gemini upload. Advanced YAML configuration remains available to the CLI with `--config` and to development deployments with `CREATOR_PREFLIGHT_CONFIG`, but it is not required for ordinary browser Full Review.

The verified provider path is `google-genai` 2.22.0 with `gemini-3.7-flash`, Gemini Files API upload, native structured output, Google Search grounding metadata, Pydantic validation, bounded waits, and explicit remote deletion. This verifies that specific model/account path—not every model, device, codec, or video size.

## Optional local speech analysis

```sh
.venv/bin/python -m pip install './backend[transcription]'
```

Transcription defaults to disabled with `local_files_only: true`, so ordinary scans do not download a model. The `tiny.en` CPU/`int8` path was smoke-tested with `faster-whisper` 1.2.1. Initial model acquisition may require a download; inference itself is local. No cloud speech API is used.

## Architecture

```text
React web app ─┐
               ├─ FastAPI / CLI ─ PreflightScanner ─ typed PreflightReport
CLI ───────────┘                    ├─ FFmpeg + package + caption checks
                                    ├─ optional local Whisper
                                    └─ optional shared Gemini upload session
                                       ├─ Promise Check
                                       ├─ Final Viewer Pass
                                       └─ Claim extraction → one grounded search request
```

The API and CLI share the same scanner and validated YAML configuration. Provider-specific lifecycle and grounding code stays behind task-specific Pydantic trust boundaries. Reports separate the creator-content verdict (`READY`, `NEEDS_REVIEW`, or `BLOCKED`) from scan completeness (`COMPLETE`, `PARTIAL`, or `FAILED`), so a provider outage does not become a content warning or fabricate an AI pass.

The local API streams uploads to temporary storage with a 2 GiB default limit, runs synchronous media/provider work outside the async event loop, admits at most two scans by default, and accepts expensive browser requests only from configured local origins. These limits are configurable in `config/preflight.default.yml`.

See [`docs/SPEC.md`](docs/SPEC.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/STATUS.md`](docs/STATUS.md) for the exact contract, implementation boundaries, and verified release status.
