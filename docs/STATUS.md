# Project Status

## Current milestone

Milestone 4.1 — frontend visual and information-architecture redesign.

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
- Desktop-first React scan workflow with input, selected-file, named-stage processing, result, and runtime-error states.
- TypeScript models matching the current backend `PreflightReport`, `Finding`, `MediaInspection`, and check-result schemas.
- Typed NEEDS_REVIEW, READY, and BLOCKED mock reports kept outside UI components.
- Professional report workspace with verdict/count summary, media metadata, local browser video preview, check coverage, evidence-focused findings, and category filters.
- Proportional, timestamp-only findings timeline with hover/focus detail and shared click-to-seek behavior for markers and finding timecodes.
- Responsive desktop, laptop, and narrow stacked layouts with keyboard focus styling and reduced-motion handling.
- Reusable application/runtime error presentation that is visually and semantically separate from a successful BLOCKED scan.
- Light, neutral productivity-tool visual language with no gradients, glows, background grids, glass effects, or heavy shadows.
- Results hierarchy centered on the checked filename, compact verdict/count summary, dominant video review surface, attached timeline, and divider-based findings list.
- Technical media metadata consolidated into one supporting line; the primary check-coverage grid replaced by a native disclosure with simple outcome rows.
- Finding evidence moved behind per-finding disclosures while titles, explanations, suggestions, and clickable timecodes remain immediately scannable.
- New-scan form consolidated into one work surface with a direct page heading and no decorative workflow numbering or redundant micro-headings.
- Development mock-state selector removed from visible product chrome while remaining available to automated tests and visual QA.

## Not implemented

- Real frontend-to-FastAPI integration; the Milestone 4 frontend uses typed mock reports and simulated named-stage progression only. Integration remains Milestone 5 work.
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

## Known frontend limitations

- No frontend request reaches FastAPI in Milestone 4.1. The visually hidden development state selector and short named-stage progression exist only to exercise the completed UI states during development and demos.
- A selected local browser video is previewed with an object URL, but the displayed report remains typed mock data and may not describe that selected file.
- No demo video is bundled. Click-to-seek remains available when the user selects a browser-playable local video; otherwise timestamps and timeline evidence render without playback.
- Timeline filtering is category-based only. Severity filtering and richer overlap lanes are intentionally deferred.

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
- `cd frontend && npm test` — 1 test file passed; 10 tests passed, 0 failed. Covered disabled scan action, verdict/count rendering, typed findings, category filtering, global findings, timestamp formatting, click-to-seek, READY, BLOCKED, runtime ERROR, and long-content resilience.
- `cd frontend && npm run build` — passed; `tsc -b` compiled cleanly and Vite 8.2.2 produced the production bundle (1,825 modules transformed).
- `cd frontend && npm run` — confirmed there is no separate lint or formatting command configured; TypeScript checking is part of the production build.
- In-app browser visual QA at 1440px — inspected new scan, selected-video, named-stage processing, NEEDS_REVIEW, READY, BLOCKED, and application ERROR states using a locally generated 12-second synthetic video. No browser console warnings or errors were observed.
- In-app browser responsive QA at 1024px and 430px — no document-level horizontal overflow; the 1024px results workspace retained its two-column inspection/evidence layout, and the narrow results and form layouts stacked into 398px-wide columns within the 430px viewport.
- Browser interaction QA — Audio filtering reduced the rendered findings from 5 to 2; timeline markers were positioned at 16.6667%, 25%, and 58.3333% for the 2s, 3s, and 7s events in a 12-second report; marker and timecode actions sought the selected HTML5 video to 2s and 7s respectively; timeline hover revealed title plus interval; keyboard focus styling was visible.
- Milestone 4.1 `cd frontend && npm test` — 1 test file passed; 11 tests passed, 0 failed. Existing behavioral coverage remains intact and now explicitly covers both finding-timecode and timeline-marker seek paths.
- Milestone 4.1 `cd frontend && npm run build` — passed; `tsc -b` compiled cleanly and Vite 8.2.2 transformed 1,825 modules.
- Milestone 4.1 `git diff --check` — passed. No separate lint or formatting command is configured.
- Milestone 4.1 visual-language audit — source search found no gradients, glows, box shadows, backdrop filters, background grids, decorative eyebrow labels, or visible mock-preview labels.
- Milestone 4.1 in-app browser QA at 1440px, 1280px, 1024px, and 430px — input, selected-file, processing, NEEDS_REVIEW, READY, BLOCKED, and runtime ERROR states inspected at normal browser zoom. No document-level horizontal overflow or browser console warnings/errors were observed.
- Milestone 4.1 results QA — video occupied approximately 63.6% of the desktop work surface at 1440px; metadata rendered as one line; the 14-check list remained collapsed by default; findings rendered as divider-separated review rows; the result and input columns stacked at 392px within the 430px viewport.
- Milestone 4.1 interaction QA — category filtering reduced 5 findings to 2 Audio findings; timeline markers remained at 16.6667%, 25%, and 58.3333%; finding and marker actions sought to 2s and 7s; hover/focus detail remained visible; check and technical-evidence disclosures expanded correctly.
