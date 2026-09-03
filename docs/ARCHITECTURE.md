# Architecture

## Current state

`creator_preflight.media` validates and inspects local media; `creator_preflight.detectors` contains the independent FFmpeg checks; `creator_preflight.rules` parses creator-style chapter lines and validates video/package metadata; `creator_preflight.captions` parses and validates SRT/WebVTT content and performs interval coverage comparisons; `creator_preflight.ai_review` isolates optional Gemini file upload, structured generation, validation, and cleanup; and `creator_preflight.engine.PreflightScanner` coordinates one complete scan.

The scanner reconciles redundant black-contained freeze findings, sorts final findings deterministically, records every executed check, derives counts, and computes `READY`, `NEEDS_REVIEW`, or `BLOCKED` directly from finding statuses. Caption checks are added only when a caption file is supplied, while the speech-coverage check is added only when optional transcription is enabled and audio exists. The report contains no opaque score. Both `creator_preflight.cli` and the FastAPI unified upload endpoint call this same scanner. The React interface submits the unified multipart request and renders caption findings through its existing category, timeline, and seek behavior.

## Target shape

Creator Preflight is a local, single-application system with two adapters around one Python scanning engine:

```text
CLI adapter ───────┐
                   ├── shared scanning engine ── FFprobe / FFmpeg
FastAPI adapter ───┘             │
       ▲                         └── validated YAML configuration
       │
React web UI
```

When explicitly enabled, the engine also calls one optional provider boundary:

```text
PreflightScanner ── validated AI observation boundary ── Gemini Files/API
       │                         │
       └── deterministic scan    └── review-only normalized findings
```

The Gemini API key exists only in the backend process environment. AI-disabled scans never invoke the provider. Provider failure becomes a non-blocking, structured unavailable review state and cannot erase deterministic results.

The scanning engine owns input normalization, detector orchestration, finding normalization, deterministic status aggregation, and report serialization. Adapters translate CLI arguments or local HTTP request data into the same engine input and must not duplicate scan rules.

## Repository layout

```text
backend/                 Python package and backend tests
  src/creator_preflight/ Installable package namespace
  tests/                 pytest suite
frontend/                React and TypeScript client
config/                  Versioned default configuration
docs/                    Product, architecture, and status documents
scripts/                 Repository automation scripts
```

## Planned backend boundaries

- `creator_preflight.engine`: application-neutral scan orchestration and report aggregation.
- `creator_preflight.models`: input, configuration, finding, and report types.
- `creator_preflight.detectors`: focused media and metadata checks that return normalized findings.
- `creator_preflight.media`: subprocess boundary for FFmpeg and FFprobe.
- `creator_preflight.api`: thin FastAPI adapter.
- `creator_preflight.cli`: thin command-line adapter.
- `creator_preflight.captions`: deterministic caption parsing, validation, coverage, and speech/caption interval comparison.
- `creator_preflight.transcription`: optional lazy local faster-whisper adapter.
- `creator_preflight.ai_review`: optional Gemini SDK adapter, bounded remote file lifecycle, native structured-output validation, and observation normalization boundary.

The `engine`, `models`, `rules`, `detectors`, `media`, `api`, and `cli` boundaries now exist at the scope required through Milestone 3. Rule and detector logic do not depend on FastAPI, CLI formatting, or React. Adapters translate inputs and render results only. FFmpeg/FFprobe execution uses argument arrays rather than a shell, enforces timeouts, captures diagnostics, and converts tool failures into typed application errors.

Milestone 2 uses one FFmpeg pass per applicable analysis filter. This straightforward sequential design favors reliable parsing and independent testing over premature optimization. Detectors analyze the first selected video or audio stream, matching the primary-stream metadata convention from Milestone 1.

Final finding order is deterministic: blocking findings precede review findings, timestamped findings precede global/package findings within a status, and timestamp/code/message break remaining ties. A freeze is suppressed only when at least 90% of its interval overlaps one detected black interval.

## Data and execution

The web client sends a browser-selected video, title, description, and optional captions to a FastAPI server running on the same machine. Vite proxies `/api` to FastAPI during local development. The server returns the normalized report in the same request, closes the uploads, and removes its temporary directory after success or failure. The selected browser file supplies the local preview; media is not downloaded back from the server. The application does not persist scans in a database.

Configuration is loaded from YAML, validated before scanning, and passed explicitly into the engine. Defaults live in `config/preflight.default.yml`. Reports include a schema version so formats can evolve without silent ambiguity.

## Status and dependency direction

The overall status order is `READY < NEEDS_REVIEW < BLOCKED`. Aggregation is deterministic and independent of presentation. The dependency direction is adapters → engine → domain models/media boundary; the domain layer never imports an adapter.

The core runtime depends on Python packages, Node build tooling for the frontend, and locally installed FFmpeg/FFprobe. Deterministic scans do not depend on network services at scan time. `faster-whisper` is isolated in the `transcription` optional dependency group, imported lazily, and disabled by default. The default `local_files_only` setting prevents an implicit model download; loaded models are reused within the backend process.

Gemini support is isolated in the `ai` optional dependency group and disabled by default. When enabled, the backend reads `GEMINI_API_KEY`, uploads the video once, polls provider processing within a configured bound, requests native schema-constrained output, validates observation types and timestamps locally, and attempts explicit remote deletion. Remote file identifiers and secrets are not exposed in findings; only safe provider/model/status provenance is serialized. Gemini observations are warning-level evidence in Milestone 11 and cannot produce `BLOCKED`.
