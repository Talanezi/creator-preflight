# Creator Preflight

Creator Preflight is a local-first, pre-publish QA project for video creators. Its Python backend can inspect local media, run deterministic FFmpeg anomaly checks, validate creator publishing metadata, and produce an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report.

The unified scanner is available through the `creator-preflight` CLI and a FastAPI upload endpoint. The React and TypeScript frontend provides the polished Milestone 4 scan workflow and report UI using typed mock reports. It is intentionally not connected to the backend yet.

See `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` for the current project contract and status.
