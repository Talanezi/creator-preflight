# Architecture

## Current state

Milestone 2 implements the typed media-inspection and deterministic anomaly-detection foundation. `creator_preflight.media` validates a local file, executes FFprobe safely, and normalizes primary/default stream metadata. `creator_preflight.detectors` contains independent FFmpeg black, silence, freeze, peak, and missing-stream checks. `creator_preflight.engine.MediaAnomalyScanner` inspects once and runs applicable detectors sequentially. `creator_preflight.config` validates the detector-only YAML thresholds. `creator_preflight.models` contains media, Finding, and anomaly-scan response contracts.

A thin FastAPI adapter continues to expose only Milestone 1 temporary upload inspection at `POST /api/v1/media/inspect`; its behavior is unchanged. There is no verdict aggregation, creator package/rule engine, command-line interface, or product UI integration.

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

The `engine`, `models`, `detectors`, `media`, and `api` boundaries now exist at the scope required through Milestone 2. The CLI boundary remains future work. Detector logic must not depend on FastAPI, React, or CLI formatting. FFmpeg/FFprobe execution must use argument arrays rather than a shell, enforce timeouts, capture diagnostics, and convert tool failures into typed application errors.

Milestone 2 uses one FFmpeg pass per applicable analysis filter. This straightforward sequential design favors reliable parsing and independent testing over premature optimization. Detectors analyze the first selected video or audio stream, matching the primary-stream metadata convention from Milestone 1.

## Data and execution

The web client will send a local video, metadata, and optional captions to a FastAPI server running on the same machine. The server will keep processing local to that machine and return the normalized report. The application will not persist scans in a database. Any temporary request material must have a bounded lifetime and be removed after processing.

Configuration is loaded from YAML, validated before scanning, and passed explicitly into the engine. Defaults live in `config/preflight.default.yml`. Reports include a schema version so formats can evolve without silent ambiguity.

## Status and dependency direction

The overall status order is `READY < NEEDS_REVIEW < BLOCKED`. Aggregation is deterministic and independent of presentation. The dependency direction is adapters → engine → domain models/media boundary; the domain layer never imports an adapter.

The core runtime may depend on Python packages, Node build tooling for the frontend, and locally installed FFmpeg/FFprobe. It must not depend on network services at scan time. Optional local `faster-whisper` support belongs in a later, separately installable feature boundary.
