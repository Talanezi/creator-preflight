# Creator Preflight

Creator Preflight is a local-first, pre-publish QA project for video creators. Through Milestone 3, its Python backend can inspect local media, run deterministic FFmpeg anomaly checks, validate creator publishing metadata, and produce an explainable `READY`, `NEEDS_REVIEW`, or `BLOCKED` report.

The unified scanner is available through the `creator-preflight` CLI and a FastAPI upload endpoint. The React and TypeScript frontend remains a buildable skeleton and is not integrated with scanning yet.

See `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` for the current project contract and status.
