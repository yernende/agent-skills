---
name: browser-video-qa
description: Record browser video, slideshow, or both, with a visible cursor, captions below the viewport, and local Windows narration by default. Quick recording is the default; strict QA requires an explicit request. Not for analyzing an existing bug-report video.
---

# Browser Video QA

Deliver the requested browser journey in the requested format: **video**, **slideshow**, or **both**. Default to a short continuous video. Capture browser content only, without desktop/system audio. On Windows, narrate the captions locally by default; elsewhere or with narration off, keep a silent AAC track.

## Choose the assurance level

- **Quick (default):** record the requested path once, export it, check metadata and visually inspect 2–3 finished frames for readable captions, a visible cursor, and the final state. Include a dragging frame when relevant. Do not add API/file comparisons, regression scenarios, independent reviews, or a full decode merely to record a clip.
- **Strict (explicit request only):** check the requested acceptance criteria, compare persisted API/file data when the claim needs it, fully decode the final file once, and inspect the key states plus a sequence around movement. The skill name, the word “QA”, or the agent's opinion of a task's importance does not select strict mode.
- Both modes must perform every action/check explicitly requested by the user. Mode selection never reduces their requested scope. In quick mode describe what was observed, without claiming comprehensive acceptance.

## Prepare and record

- Establish the requested path, environment, and authorized test data. Reuse existing permitted access/browser tools. Keep setup outside the delivered story and artifacts outside source control; exclude credentials and unrelated private content from the viewport.
- Write an ordinary task-specific script using real UI input. Do not inject application state or invent cursor events. Recording alone does not require source research or a test suite. Use a short pointer sample only for a new/unknown capture setup or after a capture problem, not before every routine recording.
- For Playwright, read [references/playwright.md](references/playwright.md). Its helper provides the real cursor, warm breathing halo, held-button ring, optional control outline, caption timing, and media export. Use existing dependencies rather than upgrading an application for recording.
- Captions default to a **separate band below the browser image**, baked into the delivered MP4 or screenshot. They must not cover the viewport or change application layout. Keep text in the user's language, usually one or two short lines. In-viewport top/bottom captions require an explicit choice.
- On Windows, prepare the caption phrases before recording with `prepareNarration` from [scripts/narration.mjs](scripts/narration.mjs), then pass the prepared assets to recording and export. It defaults to `narration: "auto"`, Microsoft Irina Desktop, normal rate. Honor “without narration” with `narration: "off"`; `voice` can select another installed Windows voice. Use System.Speech only, without cloud calls, model downloads, extra NPM packages, or speaker playback.
- Show actual pointer movement/clicks and intermediate moves during dragging. After navigation/reload, make a real move or hover on a known safe element so the pointer appears in the new document. Keep its halo visible while stationary.
- Pass an already-known locator as `target` when a caption discusses a control. Its temporary outline does not click, focus, or scroll it. For a canvas, direct attention with real pointer movement.
- Hold meaningful states long enough to read them, normally 2 seconds; prepared speech extends a recorded step until the phrase finishes plus 200 ms. Do not cut, accelerate, or overlap speech. Aim for 30–90 seconds when the path permits. Keep transitions continuous; do not disguise cuts or acceleration as continuous real-time evidence.
- For slideshow-only requests, capture the planned states without recording video; `holdMs: 0` avoids video pacing. Pass slide paths and caption text at export so each slide can last at least its speech duration plus 200 ms. For both formats, reuse screenshots and prepared speech from the same run. Do not wait for the infinite cursor pulse or disable application animations for a still.
- Save/finalize the owned recording even when a step fails, and close only its own context. Deliver the observed failure or limitation rather than automatically starting a debugging/fix project. Before retrying external writes, inspect what already persisted. Do not repeat a usable full run for cosmetic changes; reprocess its raw recording and caption track.

## Export and deliver

- Use [scripts/media.mjs](scripts/media.mjs) for one-pass MP4 export: H.264 Main 4.0, yuv420p, 25 FPS, one AAC LC 44.1 kHz stereo track, both tracks default, cleared source metadata/chapters, and faststart. Audio contains prepared speech with silent gaps, or complete silence when narration is off/unavailable. Video and slideshow share this profile. The silent version worked in the user's Telegram test; do not claim a fresh Telegram test or send media there without a request.
- Keep WAV assets with the raw recording for re-export without another synthesis/run. If synthesis is unavailable, or prepared speech cannot fit its recorded intervals, export silent AAC and explicitly report the returned narration status/reason. Do not automatically install voices or switch providers. Narration does not select strict QA or require transcription/ASR checks for ordinary recording.
- `quick` returns metadata/sample verification with `decodeValid: null`; this means no full decode was performed. `strict` returns `decodeValid: true` only after decoding the entire file. After strict conversion, extract frames in quick mode to avoid another full decode.
- Visually inspect the **finished media**, not just source screenshots. Quick needs only 2–3 representative frames; strict needs the relevant checkpoints and movement sequence. Check captions, cursor, framing, and final state. Metadata/decoder success alone cannot establish visible behavior.
- Return the media inline with a short result and any material limitation. Identify live/local/mocked environments accurately. Label still-based output as a slideshow; it does not establish smoothness or transient behavior. Do not claim to have watched every moment after inspecting sampled frames.
- Tracker uploads, issue closure, commits, deployment, and unrelated feature fixes are outside this skill unless separately requested.
