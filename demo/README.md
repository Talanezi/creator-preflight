# Demo package

This package demonstrates real Creator Preflight analysis without downloaded media, accounts, API keys, or optional Whisper. The generated 12-second video contains known black, silent, frozen, and deliberately hard-limited audio intervals. The valid SRT covers the full timeline so the primary demo shows caption parsing without extra caption warnings. The 113-character title intentionally produces the demo's single publishing-package warning.

From the repository root, after completing the backend installation in the main README:

```sh
./scripts/run_demo.sh
```

The command generates `demo/generated/creator-preflight-demo.mp4` and scans it with `title.txt`, `description.txt`, and `captions.srt`. The wrapper treats the CLI's expected findings exit code (`1`) as a successful demo run.

Expected findings are black video near 2–5 seconds, silence near 3–6 seconds, a non-black freeze near 7–10 seconds, a global warning for sustained near-full-scale audio sample density, and one title-length recommendation. Captions should parse as four valid cues with 100% merged timeline coverage and no caption findings.
