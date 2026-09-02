# Backend

Milestone 1 provides typed local media inspection through FFprobe and a minimal FastAPI upload endpoint. It does not include detectors, verdict logic, or a CLI.

FFprobe must be installed for inspection. FFmpeg is used only to generate deterministic test media. The test suite creates tiny synthetic MP4 files in pytest-managed temporary directories; no media is downloaded or committed.

Run the backend tests from the repository root:

```sh
.venv/bin/python -m pytest backend/tests
```

The inspection endpoint is `POST /api/v1/media/inspect` with a multipart field named `file`.
