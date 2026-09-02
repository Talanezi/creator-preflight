# Creator Preflight

Creator Preflight is a local-first, pre-publish QA project for video creators. Its Python backend can inspect local media, run deterministic FFmpeg anomaly checks, validate creator publishing metadata, and produce an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report.

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

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the local backend on port 8000. Captions are presence-only; caption parsing, transcription, and Whisper are not implemented.

See `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` for the current project contract and status.
