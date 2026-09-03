# Creator Preflight judge demo

## Prepare the package

From the repository root:

```sh
.venv/bin/python scripts/prepare_judge_demo.py
```

This generates ignored local media under `demo/generated/judge/` and uses the tracked package inputs under `demo/judge/`:

- defective video: `demo/generated/judge/creator-preflight-judge-defective.mp4`
- corrected video: `demo/generated/judge/creator-preflight-judge-corrected.mp4`
- thumbnail: `demo/generated/judge/creator-preflight-judge-thumbnail.png`
- title: `demo/judge/title.txt`
- description: `demo/judge/description.txt`
- captions: `demo/judge/captions-defective.srt` or `captions-corrected.srt`
- opt-in Gemini profile: `demo/judge/ai-config.yml`

The generator uses only locally drawn graphics and macOS speech synthesis. No generated binary is tracked.

For deterministic-only judging, use the default backend configuration. For all three optional Gemini tasks, export `GEMINI_API_KEY` in the backend terminal and start FastAPI with:

```sh
CREATOR_PREFLIGHT_CONFIG=demo/judge/ai-config.yml \
  .venv/bin/uvicorn creator_preflight.api:app --app-dir backend/src --host 127.0.0.1 --port 8000
```

Then start `cd frontend && npm run dev -- --host 127.0.0.1` and open `http://127.0.0.1:5173`.

## Recommended 90–120 second sequence

1. **0–10s — problem.** “A final export can look finished and still contain mistakes that are painful to discover after publishing.”
2. **10–25s — load the defective package.** Select the defective video, tracked title/description/captions, and aligned thumbnail, then run Preflight.
3. **25–45s — technical evidence.** Open the black-section finding and click `00:12.00–00:15.07`; the local video seeks to the export gap.
4. **45–65s — editorial evidence.** Show the Promise summary and seek the delayed-promise finding to its evidence interval.
5. **65–85s — verified AI evidence.** Briefly reference the controlled M13 Viewer Pass proof (spoken `2021` versus visible `2020`, placeholder, and accidental repetition) and the controlled M14 Claim Review proof (Apollo 11/1968 at 12s, one grounded conflict, and real provider citations). State clearly that these are focused acceptance fixtures, not findings from the realistic video.
6. **85–105s — corrected ending.** Start a new scan and load the corrected video with `captions-corrected.srt`. Its full production scan is `READY`: 23/23 checks, Promise aligned from 0s, Viewer clean, and no Claim conflict.
7. **105–115s — close.** “Creator Preflight reviews the finished upload before your audience does.”

## Evidence map

| Layer | Defective evidence | Corrected behavior |
|---|---|---|
| Technical integrity | black video at 12.0–15.07s | no technical findings |
| Promise Check | subject begins at about 24s, beyond the 20s policy | subject begins immediately |
| Final Viewer Pass | demonstrated separately by the verified M13 controlled fixture | clean on the corrected realistic package |
| Claim Review | demonstrated separately by the verified M14 Apollo 11/1968 fixture at 12s | no conflict on the corrected realistic package |
| Captions | five valid cues, full timeline coverage | five valid cues, full timeline coverage |

The main realistic demo intentionally promises only the evidence verified reliably on that package: `AI_PROMISE_DELAY` at 0–24s and `VIDEO_BLACK_SEGMENT` at 12.0–15.066667s. Claim Review abstained on that defective package, so no claim result should be fabricated or attributed to it. The verified M13 and M14 focused fixtures provide the Viewer Pass and grounded Claim Review proof. The corrected realistic package completed a full production scan as `READY` with 23/23 checks, one shared upload, four generation requests, and successful cleanup.
