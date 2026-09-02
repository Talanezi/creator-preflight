# Project Status

## Current milestone

Milestone 1 — media inspection core.

Status: completed on 2026-09-01.

## Completed

- Product scope and priorities documented.
- Target architecture and repository boundaries documented.
- Backend and frontend skeletons created.
- Default YAML configuration and scripts directory created.
- Backend package installed successfully in a clean local virtual environment.
- Backend pytest suite and default YAML parse check passed.
- Frontend dependencies installed and the production TypeScript/Vite build passed.
- Typed media inspection implemented with safe FFprobe subprocess execution.
- Primary/default video and audio stream metadata normalized with stream counts.
- Shared normalized Finding schema implemented with Pydantic.
- Minimal temporary-upload FastAPI inspection endpoint implemented.
- Deterministic synthetic video fixtures generated locally with FFmpeg.

## Not implemented

- Shared scanning engine and normalized report aggregation.
- Anomaly detectors, scoring, or verdict logic.
- CLI functionality.
- Product frontend and scan workflow.
- Captions or metadata rules.
- Optional local `faster-whisper` support.

## Blockers

None known.

## Validation

- `.venv/bin/python -m pip install './backend[dev]'` — succeeded.
- `.venv/bin/python -m pytest backend/tests` — 15 passed, 0 failed, 1 upstream Starlette TestClient deprecation warning.
- FFmpeg smoke fixture generation — succeeded with a local synthetic 0.5-second video and audio file.
- `PYTHONPATH=backend/src .venv/bin/python -c "from creator_preflight.media import MediaInspector; ..."` — succeeded; normalized duration 0.5 seconds, 128×72 video at 25 fps, MPEG-4 video, AAC mono audio at 44,100 Hz.
- No formatting, type-checking, or other static-check commands are configured in the repository.
