# Project Status

## Current milestone

Milestone 2 — deterministic video/audio anomaly detection.

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
- Typed detector-only YAML configuration with validated units and ranges.
- Independent FFmpeg black, long-silence, freeze/static-frame, and global audio peak detectors.
- Missing-video and missing-audio findings based on Milestone 1 metadata.
- Minimal sequential anomaly scanner returning metadata and normalized findings without a product verdict.
- Deterministic 12-second anomaly fixture with known black, silence, static, and peak regions.

## Not implemented

- Full creator-package rule engine and normalized report aggregation.
- Scoring or overall verdict logic.
- CLI functionality.
- Product frontend and scan workflow.
- Captions or metadata rules.
- Optional local `faster-whisper` support.

## Blockers

None known.

## Known detector limitations

- Black frames are also static frames, so a sustained black section can legitimately produce both black and freeze findings.
- Audio peak inspection is a global decoded peak measurement from FFmpeg `volumedetect`; it does not provide or fabricate a timestamp and is not a distortion or compliance certification.
- Detectors analyze the first selected video or audio stream. Stream counts remain available from media inspection, but per-stream anomaly reports are not implemented.
- Each applicable detector uses a separate bounded FFmpeg pass. This is reliable and fast for short demo media but intentionally not optimized into a combined filter graph.
- Static shots, title cards, still images, intentional silence, and intentional dark sections can produce review warnings; findings are evidence for review, not claims of definite corruption.

## Validation

- `.venv/bin/python -m pytest backend/tests/test_config.py backend/tests/test_detectors.py -q` — 14 passed, 0 failed.
- `.venv/bin/python -m pytest backend/tests` — 29 passed, 0 failed, 1 upstream Starlette TestClient deprecation warning.
- Deterministic anomaly fixture generation from scratch through `backend/tests/conftest.py::_generate_anomaly_video` — succeeded; generated media was 12.0 seconds, 160×90, 24 fps, with mono 48 kHz audio.
- Actual `MediaAnomalyScanner` smoke run using `config/preflight.default.yml` — succeeded and serialized as the normalized Pydantic schema.
- Expected versus detected intervals: black 2.0–5.0 seconds → 2.0–5.0; silence 3.0–6.0 → 3.0–6.000021; non-black freeze 7.0–10.0 → 7.0–10.0. The deliberately loud global audio region produced a measured peak of 0.0 dBFS and no fabricated timestamp.
- Milestone 1 API and media inspection tests are included in the 29-test full-suite result and remain passing.
- No formatting, type-checking, or other static-check commands are configured in the repository.
