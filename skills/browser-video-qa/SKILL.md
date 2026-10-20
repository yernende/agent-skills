---
name: browser-video-qa
description: Verify a browser feature or user journey and deliver video, a slideshow, or both, with a visible cursor and captions. Use for recorded walkthroughs or visual acceptance checks; not for routine code-only changes or analysis of an existing bug-report video.
---

# Browser Video QA

Check the requested behavior and make the result easy to assess without opening the application. Honor the requested format: **video**, **slideshow**, or **both**. Default to a short continuous video only when no format is specified; a requested slideshow is a first-class result. Browser content only; no desktop capture or generated narration.

## Prepare

- Establish the expected result, relevant edge cases, environment, and authorized test data. Reuse existing access and browser tooling within their operating rules. Do not bypass tool restrictions to obtain a recording.
- Plan a small storyboard of key states, the action between them, and the evidence each state should show. Use that same storyboard for either format: select meaningful frames for slides; record the transitions and pause at those frames for video. Avoid unrelated navigation and setup in the delivered story.
- Keep setup and investigation outside the demonstration where practical. Write an ordinary task-specific script, with real UI actions and assertions; do not build a scenario DSL. Do not expand this into mandatory source review or a full test-suite run.
- Put recordings, screenshots, scripts for this particular run, and extracted frames in a task artifact directory outside source control. Avoid credentials or unrelated private content in the captured viewport.
- With Playwright, read [references/playwright.md](references/playwright.md) for the supplied overlay and media helpers. Otherwise use the available tool's supported capture facilities. Confirm with a short sample that the pointer actually appears before recording a long journey.

## Check and record

- For video, show real pointer movement, clicks, and pressed-button state during dragging. Hold each verified key state long enough to understand the result and read its caption (usually 2–3 seconds); keep recording the transitions continuously. Use captions in the user's language. Aim for roughly 30–90 seconds when the journey permits; keep critical timing intact.
- For a requested slideshow, capture only the planned key states after their checks pass. Do not record video just to produce slides. Keep the frames in scenario order with readable captions and viewing durations. When both formats are requested, take the slide checkpoints during the same recorded and verified run.
- Exercise the requested path and relevant boundary cases. Perform UI interactions through input APIs; do not inject application state to manufacture the result. For persistence, save through the UI, reopen or reload, and compare with the saved API/file data when that claim needs it. An HTTP success alone does not prove the visible result.
- Verify the delivered run itself. A clean demonstration repeated after investigation must contain its own checks. Do not conceal failures, splice separate attempts into apparent continuity, or describe accelerated motion as real-time evidence.
- Finalize recordings through the supported API, even when a check fails. Close only the context owned by this run. Preserve the failure and distinguish a failed feature check from a recording problem.

## Inspect and deliver

- Use [scripts/media.mjs](scripts/media.mjs) to convert or assemble MP4, validate decoding, and extract frames. Visually inspect the finished media at its key states; for video, also inspect a sequence around movement. Decoder success and source screenshots alone do not prove readable captions or a visible cursor.
- Check that text is legible, overlays do not cover the result, the pointer is visible, and the last frame agrees with the assertions. For video, also check that dragging is visible. State any limit of the inspection; do not claim to have watched every moment if only key frames were examined.
- For a chosen slideshow, or when recording is unavailable, make a clearly labelled slideshow from the key-state screenshots. Stills cannot establish smoothness or transient behavior. Never invent pointer coordinates; if the capture cannot show the pointer, explicitly report that requirement unmet rather than call the visual acceptance complete.
- Return the media inline when supported, with a short verdict separating **behavior verified** from **media usable**, material gaps, and relevant result links. Identify local, mocked, and live environments accurately.
- Uploading to a tracker, closing an issue, committing, or deploying is outside this skill unless the user separately requests it. Do not automatically rerun a failed scenario that repeats external writes without checking what already persisted.
