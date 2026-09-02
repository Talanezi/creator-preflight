# Project Status

## Current milestone

Milestone 3 — unified rule engine, publishing-package validation, report, and CLI.

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
- Typed publishing-package inputs for title, description, caption presence, and profile identifier.
- Typed creator rules for streams, dimensions, aspect ratios, title, description, URL syntax, chapters, and caption presence.
- Deterministic chapter parsing for timestamp-led `MM:SS` and `H:MM:SS` description lines.
- Unified `PreflightReport` with explicit check outcomes, passed/warning/critical counts, runtime, configuration identity, stable finding order, and transparent verdict logic.
- Report-level reconciliation suppressing freezes at least 90% contained by a black interval while preserving other freezes.
- Shared `PreflightScanner` used by the CLI and unified FastAPI upload endpoint.
- Human and JSON CLI output with documented exit codes 0, 1, and 2.

## Not implemented

- Product frontend and web scan workflow.
- Caption file parsing, cue validation, or caption coverage analysis.
- SRT/VTT parsing, transcription, or speech analysis.
- Optional local `faster-whisper` support.
- Platform integrations, persistence, deployment, or account features.

## Blockers

None known.

## Known detector limitations

- Black frames are also static frames, so a sustained black section can legitimately produce both black and freeze findings.
- Audio peak inspection is a global decoded peak measurement from FFmpeg `volumedetect`; it does not provide or fabricate a timestamp and is not a distortion or compliance certification.
- Detectors analyze the first selected video or audio stream. Stream counts remain available from media inspection, but per-stream anomaly reports are not implemented.
- Each applicable detector uses a separate bounded FFmpeg pass. This is reliable and fast for short demo media but intentionally not optimized into a combined filter graph.
- Static shots, title cards, still images, intentional silence, and intentional dark sections can produce review warnings; findings are evidence for review, not claims of definite corruption.
- Caption validation is presence-only; the supplied path/upload contents are not parsed.
- Chapter parsing recognizes only lines beginning with `MM:SS` or `H:MM:SS` followed by a name. Inline times and ordinary numbers are intentionally ignored.
- URL validation reports only obvious syntax errors in HTTP(S)/`www.`-style tokens. It does not resolve, request, classify, or establish the safety of a URL.
- CLI exit code 1 represents a completed scan with either `NEEDS_REVIEW` or `BLOCKED`; it is not a runtime crash.

## Validation

- `.venv/bin/python -m pip install './backend[dev]'` — succeeded and installed the `creator-preflight` console entry point.
- Targeted Milestone 3 configuration/rules/report/CLI/API run — 42 passed, 0 failed, 1 upstream Starlette TestClient deprecation warning.
- `.venv/bin/python -m pytest backend/tests` — 69 passed, 0 failed, 1 upstream Starlette TestClient deprecation warning. All Milestone 1 and 2 tests remain included and passing.
- Fresh deterministic fixtures generated through `backend/tests/conftest.py`: a 12-second anomaly fixture and a one-second clean control — succeeded.
- Direct unified `PreflightScanner` smoke scan with a deliberate title-length warning — `NEEDS_REVIEW`; 14 checks run, 9 passed, 5 warnings, 0 critical; measured runtime approximately 0.159 seconds.
- Unified anomaly intervals: black expected 2.0–5.0 → detected 2.0–5.0; silence expected 3.0–6.0 → detected 3.0–6.000021; non-black freeze expected 7.0–10.0 → detected 7.0–10.0.
- The redundant freeze at black 2.0–5.0 was absent from final reconciled findings; the 7.0–10.0 freeze remained. `TITLE_LENGTH_RECOMMENDATION` supplied the deliberate package warning.
- Actual installed CLI human scan — completed with `NEEDS_REVIEW`, 9 pass / 5 warn / 0 fail, and exit code 1.
- Actual installed CLI JSON scan — emitted JSON-only stdout, parsed successfully, reported the same verdict/counts, and returned exit code 1.
- Actual installed CLI clean scan — emitted a `READY` JSON report with 14 passed checks and returned exit code 0.
- Actual installed CLI missing-input scan — wrote a structured error to stderr, left JSON stdout empty, and returned exit code 2.
- Unified FastAPI scan test returned a schema-valid `PreflightReport`; the Milestone 1 inspection endpoint tests remain passing.
- No formatting, type-checking, or other static-check commands are configured in the repository.
