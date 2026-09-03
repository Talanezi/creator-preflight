# Creator Preflight

**Lint your video before you publish it.**

Creator Preflight is a local-first quality check for finished creator videos. Give it a video, title, description, and optional captions; it returns an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report with exact timestamps for media issues.

The web interface keeps the selected video available for local preview, so clicking a timestamped finding or timeline marker seeks directly to that moment. The same Python scanner powers the web API and CLI, and its detector and publishing rules are configurable in YAML.

## What it checks

- FFmpeg/FFprobe inspect media structure and detect sustained black video, long silence, frozen frames, suspicious concentrations of near-full-scale audio samples, and missing streams.
- Publishing-package rules check resolution, aspect ratio, title, description, URLs, chapters, and caption requirements.
- UTF-8 SRT and WebVTT files are parsed for timing, ordering, range, overlap, empty text, gaps, and merged timeline coverage.
- Optional `faster-whisper` can compare locally detected speech intervals with caption coverage. The `tiny.en` CPU/`int8` path has been smoke-tested; model acquisition may require an initial download, while inference runs locally.

FFmpeg analysis is deterministic media processing, not AI. Optional Whisper is disabled by default and is not required for the primary demo or ordinary scans. Core deterministic scans use no paid API, platform account, API key, cloud inference, or external media. Optional Gemini video-review infrastructure is separately opt-in and sends the selected video to Google only when explicitly enabled.

## Quick start

Prerequisites:

- Python 3.10 or newer
- FFmpeg and FFprobe on `PATH`
- Node.js and npm for the web interface

Install the backend from the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install './backend[dev]'
```

Install the frontend:

```sh
cd frontend
npm install
cd ..
```

## Reproducible demo

The primary demo uses only generated media and tracked text fixtures. It does not require Whisper or a network connection after installation.

Run the complete CLI demo with one command:

```sh
./scripts/run_demo.sh
```

This generates `demo/generated/creator-preflight-demo.mp4`, then scans it with the tracked title, description, captions, and default YAML configuration. Expected results are:

- black video near 2–5 seconds;
- silence near 3–6 seconds;
- a non-black freeze near 7–10 seconds;
- one global near-full-scale audio-density warning from a deliberately hard-limited interval;
- one title-length recommendation;
- four valid caption cues covering 100% of the 12-second timeline, with no caption findings.

The expected verdict is `NEEDS_REVIEW` with 20 checks run, 15 passed, 5 warnings, and 0 critical findings. The wrapper exits successfully after this expected review result; the underlying CLI uses exit code `1` for a completed scan containing findings.

To generate only the video:

```sh
.venv/bin/python scripts/generate_demo_fixture.py
```

To run the same scan directly:

```sh
.venv/bin/creator-preflight scan demo/generated/creator-preflight-demo.mp4 \
  --title "$(tr -d '\r\n' < demo/title.txt)" \
  --description-file demo/description.txt \
  --captions demo/captions.srt \
  --config config/preflight.default.yml
```

Add `--json` for machine-readable output. See [`demo/README.md`](demo/README.md) for the fixture package details.

## Run the web app

Start the local FastAPI backend in one terminal:

```sh
.venv/bin/uvicorn creator_preflight.api:app --app-dir backend/src --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another:

```sh
cd frontend
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`, select the generated video and `demo/captions.srt`, then paste the tracked title and description. Vite proxies the scan request to the local backend. Upload copies are temporary and removed after each request.

## Optional local speech analysis

Install the existing optional dependency with:

```sh
.venv/bin/python -m pip install './backend[transcription]'
```

Enable transcription in a YAML configuration only when wanted. Defaults remain `enabled: false` and `local_files_only: true`, preventing an unexpected model download. No cloud speech API is used, but acquiring a model for the first time requires an explicit download or a compatible model already present locally.

## Optional Gemini video review infrastructure

Install the isolated provider dependency with:

```sh
.venv/bin/python -m pip install './backend[ai]'
```

Set `GEMINI_API_KEY` only in the backend process environment, then enable `ai_review` in a YAML configuration. The default configuration keeps AI review disabled. When enabled, Creator Preflight uploads the video once through Google's Gemini Files API, waits for bounded processing, requests native schema-constrained observations, validates them locally, and attempts to delete the remote file afterward. The key is never accepted from the browser or stored in YAML.

Milestone 11 provides the reusable provider boundary and objective engineering-smoke observations only. It does not implement Promise Check, factual verification, thumbnail comparison, or generic AI recommendations. AI observations are review evidence and cannot block a scan. Deterministic scanning still completes if the optional SDK, key, or provider is unavailable.

The `google-genai` 2.22.0, `gemini-3.7-flash` path has been smoke-tested with an actual generated video upload, native structured observations, timestamp validation, and explicit remote-file cleanup. This verifies that specific integration path, not every Gemini model, account, video size, or codec.

## Architecture

React sends a local multipart request to FastAPI; FastAPI and the CLI both invoke `PreflightScanner`; the scanner applies validated YAML rules, FFmpeg/FFprobe analysis, caption parsing, optional local speech comparison, and explicitly enabled Gemini review. Provider-specific Gemini code remains isolated behind the scanner. Reports use one typed schema with timestamped findings, explicit check counts, provider provenance, and a deterministic verdict.

See [`docs/SPEC.md`](docs/SPEC.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/STATUS.md`](docs/STATUS.md) for the product contract and verified status.
