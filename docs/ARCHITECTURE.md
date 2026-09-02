# Architecture

## Current state

Milestone 0 contains boundaries and build scaffolding only. There is no scanner, detector, API endpoint, command-line interface, media processing, or product UI yet.

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

These modules describe future ownership, not modules implemented in Milestone 0. Detector logic must not depend on FastAPI, React, or CLI formatting. FFmpeg/FFprobe execution must use argument arrays rather than a shell, enforce timeouts, capture diagnostics, and convert tool failures into typed application errors.

## Data and execution

The web client will send a local video, metadata, and optional captions to a FastAPI server running on the same machine. The server will keep processing local to that machine and return the normalized report. The application will not persist scans in a database. Any temporary request material must have a bounded lifetime and be removed after processing.

Configuration is loaded from YAML, validated before scanning, and passed explicitly into the engine. Defaults live in `config/preflight.default.yml`. Reports include a schema version so formats can evolve without silent ambiguity.

## Status and dependency direction

The overall status order is `READY < NEEDS_REVIEW < BLOCKED`. Aggregation is deterministic and independent of presentation. The dependency direction is adapters → engine → domain models/media boundary; the domain layer never imports an adapter.

The core runtime may depend on Python packages, Node build tooling for the frontend, and locally installed FFmpeg/FFprobe. It must not depend on network services at scan time. Optional local `faster-whisper` support belongs in a later, separately installable feature boundary.

