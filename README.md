# Creator Preflight

Creator Preflight is a local-first, pre-publish QA project for video creators. Its Python backend can inspect local media, run deterministic FFmpeg anomaly checks, validate creator publishing metadata and UTF-8 SRT/WebVTT captions, and produce an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report.

The unified scanner is available through the `creator-preflight` CLI, a FastAPI upload endpoint, and the React and TypeScript frontend. The browser uploads the selected media and publishing fields to the local FastAPI instance, renders the returned report, and keeps the selected file in a local preview for timestamp seeking. Backend upload copies are temporary and are removed after each request.

Local development requires FFmpeg and FFprobe on `PATH`. From the repository root, run the backend in one terminal:

```sh
.venv/bin/python -m pip install './backend[dev]'
.venv/bin/uvicorn creator_preflight.api:app --app-dir backend/src --reload --host 127.0.0.1 --port 8000
```

Run the frontend in another terminal:

```sh
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the local backend on port 8000. Caption inspection parses timing and text structure, checks timeline bounds/order/overlaps/gaps, and calculates merged timeline coverage. Coverage is the percentage of the full video timeline inside at least one cue; it does not prove that every spoken word is captioned.

Optional local speech/caption comparison can be installed with:

```sh
.venv/bin/python -m pip install './backend[transcription]'
```

It remains disabled until `transcription.enabled` is set in YAML. The default `local_files_only: true` prevents automatic model downloads. No cloud speech API, API key, or external inference service is used.

See `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` for the current project contract and status.
