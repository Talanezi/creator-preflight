# Devpost draft material

## Inspiration / problem

Creators often discover export mistakes, missing package details, editorial inconsistencies, or an incorrect factual detail only after publishing. Creator Preflight applies the familiar idea of a software linter to the final upload package: inspect the artifact that viewers will actually receive and point directly to evidence worth reviewing.

## What it does

Creator Preflight accepts a finished video, title, description, optional captions, and optional thumbnail. It returns a typed report with a transparent `READY`, `NEEDS_REVIEW`, or `BLOCKED` verdict, exact timestamps, evidence, and suggested review actions. In the web interface, timestamped findings and timeline markers seek the locally selected video.

The report combines deterministic media QC and publishing rules with three optional Gemini review tasks: Promise Check, Final Viewer Pass, and grounded Claim Review. SRT and WebVTT caption timing and coverage are inspected directly. Optional local Whisper can compare detected speech intervals with caption coverage.

## How it was built

FastAPI and the CLI call the same Python `PreflightScanner`. FFprobe normalizes media metadata; bounded FFmpeg filters detect sustained black, silence, freeze, and suspicious near-full-scale audio density. Pydantic models validate configuration, package inputs, findings, reports, and every AI trust boundary. React and TypeScript render the real API report without recalculating its verdict.

When explicitly enabled, one Gemini Files API upload is shared by Promise Check, Final Viewer Pass, and claim extraction. Claims are verified together in one text-only Google Search grounded request. Citation links come from provider grounding metadata, not model-authored URLs. Remote cleanup is attempted once after the video tasks.

## Technical highlights

- Deterministic, copyright-free FFmpeg fixtures with known anomaly timestamps.
- One scanner and report contract across CLI, API, and web UI.
- Conservative, review-only AI findings with confidence and evidence gates.
- Task-level failure isolation: provider failure preserves deterministic results.
- Real SRT/WebVTT parsing, merged coverage accounting, and optional local speech-gap comparison.
- Real Gemini video upload, structured output, shared-session orchestration, grounded citations, and cleanup verified on controlled fixtures.

## Challenges

The hardest work was calibrating deterministic checks to avoid treating legitimate creative content as corruption, enforcing schema and citation trust boundaries around probabilistic model output, and handling provider timeouts/quota without making deterministic scanning unreliable. AI prompts also needed to distinguish substantive delivery from a title card or superficial mention.

## Accomplishments

Creator Preflight grew from a media inspector into a working end-to-end review application with a polished web workflow, CLI/JSON output, configurable rules, deterministic caption analysis, optional verified local transcription, three isolated multimodal review tasks, click-to-seek evidence, and provider-backed citations.

The final demonstration keeps the evidence honest: a realistic creator package shows the reproducible Promise delay and black export gap, its corrected counterpart completes `READY`, and focused controlled fixtures provide the separately verified Final Viewer Pass and grounded Claim Review examples. No single video is presented as proof of every subsystem.

## Built during the hackathon

The repository contains the media inspection and detector core, report/rule engine, CLI and FastAPI surfaces, React interface, caption and optional transcription systems, Gemini provider boundary and review tasks, deterministic fixture generators, automated tests, and demo documentation.

## Limitations

Detectors identify evidence, not creative intent. Gemini observations and claim verification can abstain, miss issues, or return approximate timestamps. Claim Review checks at most three selected public claims and does not certify the entire video. Search coverage and source quality vary. Initial Whisper model acquisition and Gemini review require network access; Gemini also requires the creator to opt in and provide a server-side API key.

## Future work

Possible next steps include broader real-world evaluation, provider observability, saved local reports, and more accessible evidence comparison. These are not implemented in the hackathon release.
