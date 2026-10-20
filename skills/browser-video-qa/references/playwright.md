# Playwright recording

Use this path only when Playwright is permitted. Requires Node.js, an existing Playwright installation/browser, and FFmpeg/ffprobe with libass. The recording API has been used with Playwright 1.58.2. Do not upgrade application dependencies for recording. If recording is unavailable, use the permitted screenshot tool and clearly label a slideshow; do not silently substitute captions covering the viewport.

## Quick scenario (default)

Use real absolute paths for `PROJECT_DIR`, `SKILL_DIR`, and `ARTIFACT_DIR`. Resolve the existing Playwright package from the project. Reuse authorized authentication without printing cookies/storage state. The application locators below are illustrative.

```js
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const require = createRequire(join(PROJECT_DIR, "package.json"));
const { chromium } = require("playwright");
const { installRecordingOverlay } = await import(pathToFileURL(
  join(SKILL_DIR, "scripts/recording-overlay.mjs"),
));
const { convertMedia, inspectMedia } = await import(pathToFileURL(
  join(SKILL_DIR, "scripts/media.mjs"),
));
const { prepareNarration } = await import(pathToFileURL(
  join(SKILL_DIR, "scripts/narration.mjs"),
));
await mkdir(ARTIFACT_DIR, { recursive: true });
const phrase = "Сохраняем изменение и показываем результат.";
const narration = await prepareNarration([phrase], { dir: join(ARTIFACT_DIR, "speech") });
// Defaults to local Windows speech. Pass narration: "off" above if requested.
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(ARTIFACT_DIR, "raw"), size: { width: 1440, height: 900 } },
});
const demo = await installRecordingOverlay(context, { narration }); // Captions stay below the page.
let page;
let video;
let failure;
try {
  page = await context.newPage();
  video = page.video();
  await page.goto(TARGET_URL);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await demo.step(page, phrase, async () => {
    // Enter the user's requested value through normal UI input.
    await save.click();
    await page.getByText("Saved", { exact: true }).waitFor();
  }, { target: save });
} catch (error) {
  failure = error;
} finally {
  try { await context.close(); } finally { await browser.close(); }
}
if (video) {
  const captions = await demo.saveCaptions(page, join(ARTIFACT_DIR, "captions.json"));
  const result = await convertMedia(await video.path(), join(ARTIFACT_DIR, "result.mp4"), { captions, narration });
  const inspection = await inspectMedia(result.path, { framesDir: join(ARTIFACT_DIR, "frames") });
  console.log({ result, inspection }); // Then view the 2–3 extracted finished frames.
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
```

Quick records only the requested story; it does not add reload/API checks unless asked. Strict uses the same helpers with `convertMedia(..., { mode: "strict", captions, narration })`, the requested acceptance assertions, and more `at` sample times. Keep the following `inspectMedia` call quick: conversion already decoded the complete file.

## Local Windows narration

`prepareNarration(texts, { dir, narration: "auto", voice: "Microsoft Irina Desktop" })` defaults to the shown options. Call it before creating the recording page, with the exact caption phrases; an ordinary array/constants is sufficient, not a separate scenario language. One Windows PowerShell process loads System.Speech and writes deduplicated WAV files. Input is UTF-8 JSON, never executable text/SSML. No speaker playback, network calls, extra NPM dependencies or voice installation occurs. The default Russian voice can be changed to another installed name with `voice`.

The returned object has `status`, `voice`, `clips: [{text,path,duration}]` and, after Windows preparation, `manifestPath`. WAV files and `narration.json` stay in the run's artifact directory for reuse. Use a fresh directory; existing request/output files are not overwritten. `narration: "off"` avoids synthesis. Other operating systems return `unsupported`. A missing voice/runtime returns `unavailable` with a reason; the export keeps silent AAC. Explicitly report that outcome rather than claim a narrated clip.

Pass the same prepared object to `installRecordingOverlay` and `convertMedia`. A recorded step lasts at least the action plus `holdMs`, and at least the speech duration plus 200 ms from its caption start. Only the remaining time is added. Navigation does not reset its clock. Audio is scheduled at caption starts; phrases are not sped up, cut, or overlapped. Missing phrases or intervals too short for their audio cause an explicit silent fallback, not a false synchronized result. The low-level exporter consumes prepared assets only; it never starts synthesis while encoding.

For slideshow-only, `holdMs: 0` remains fast during capture. At export pass slide objects with their caption text:

```js
const slides = [
  { path: join(ARTIFACT_DIR, "01.png"), text: phrase },
  // Optional seconds overrides the minimum for an individual slide.
];
const slideshow = await createSlideshow(OUTPUT, slides, { seconds: 3, narration });
```

Import `createSlideshow` from media.mjs. Each slide lasts at least its requested duration and its own speech duration plus 200 ms. String-only frame lists still work for silent slideshows. For `both`, reuse the prepared clips and captured screenshots; video and slideshow each have their own timing. If explicitly using in-page top/bottom captions, omit the visual `captions` option and pass timing as `narration: { ...narration, cues: captionTrackPath }` to avoid drawing duplicate captions below the viewport.

## Cursor, captions, screenshots

Install the helper **before creating the page**. Each page has its own monotonic caption clock starting at its creation event; reload/navigation do not reset it. After closing the recording context, `saveCaptions(page, path)` writes `[{start,end,text}]` in seconds and extends the last caption through the finalized raw video's end. Encoder tail frames must not shift earlier captions. If trimming leading setup, apply the same time shift with `{ offsetSeconds: -trimSeconds }`. Check synchronization in finished frames; this is not a frame-exact media timestamp API. Avoid trimming when unnecessary. Popups have separate recordings and tracks; do not splice them into apparent single-page continuity.

`captionPosition` defaults to `"below"`: the page overlay draws only the cursor, while captions are saved for postprocessing. `demo.capture(page, path)` produces a PNG with the caption band below the viewport. For slideshow-only, omit `recordVideo`, use `step(..., { holdMs: 0, screenshotPath })`, then assemble the ordered screenshots. For both, use checkpoints from the same video run. Captures do not turn off application animations.

An explicit `captionPosition: "top"` or `"bottom"` keeps the old in-viewport placement. In that case do not pass a caption track to conversion, or it would add duplicate captions. These captions have a 200 ms entrance; capture waits only for that finite transition, not the breathing cursor pulse.

`step` holds for 2 seconds by default and rethrows a failed action after marking its caption `FAILED`. The optional `target` is one visible locator: its warm outline follows the element without changing layout, value, focus, or inline styles. It is removed in `finally`, including on failure. Navigation destroys the decoration; a new element needs a new target.

The cursor follows trusted pointer input. It has a persistent warm halo, click flash, and a steady blue ring while a button is held. **After each navigation/reload, make a real move/hover on a known safe element**; the previous document's cursor is not transferred. For a readable drag, use intermediate moves:

```js
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let index = 1; index <= 30; index++) {
  await page.mouse.move(start.x + (end.x - start.x) * index / 30,
    start.y + (end.y - start.y) * index / 30);
  await new Promise(resolve => setTimeout(resolve, 25));
}
await page.mouse.up();
```

Do not inject pointer events/application state. Touch has no mouse cursor. Browser chrome, native dialogs, pointer-lock/fullscreen and physical mobile/headset displays are not established by this capture. Only try a separate short pointer sample when the capture setup is new/unknown or has failed.

## Media commands and export profile

```text
node <SKILL_DIR>/scripts/media.mjs convert <raw.webm> <result.mp4> --captions=<captions.json>
node <SKILL_DIR>/scripts/media.mjs convert <raw.webm> <spoken.mp4> --captions=<captions.json> --narration=<speech/narration.json>
node <SKILL_DIR>/scripts/media.mjs inspect <result.mp4> --frames-dir=<frames-directory>
node <SKILL_DIR>/scripts/media.mjs convert <raw.webm> <strict.mp4> --captions=<captions.json> --mode=strict
node <SKILL_DIR>/scripts/media.mjs inspect <strict.mp4> --at=1,5,5.2,5.4,10 --frames-dir=<frames-directory>
node <SKILL_DIR>/scripts/media.mjs slideshow <slideshow.mp4> <01.png> <02.png> --seconds=3
node <SKILL_DIR>/scripts/media.mjs slideshow <spoken-slides.mp4> --slides=<slides.json> --narration=<speech/narration.json>
```

Quote paths containing spaces. `quick` is the default for all commands. `inspect` without `--at` samples start/middle/end when `--frames-dir` is supplied. It uses accurate input seeking rather than decoding from the beginning for every frame. Only strict mode performs a separate complete decode. Results report `mode`, `verification` (`metadata`, `sampled`, `full`) and `decodeValid` (`null` unless a full decode succeeded). Metadata-only output does not mean visual acceptance.

Both video and slideshow use one export pass with:

- `libx264 -preset fast -crf 18 -profile:v main -level:v 4.0 -pix_fmt yuv420p`;
- constant 25 FPS, `-g 50 -keyint_min 25 -sc_threshold 0 -tag:v avc1`;
- one audio track containing prepared speech and silent gaps, or `anullsrc=r=44100:cl=stereo` when narration is off/unavailable, mapped instead of source audio, `aac -profile:a aac_low -b:a 128k -ar 44100 -ac 2`;
- both tracks `default`, `-map_metadata -1 -map_chapters -1`, brand `mp42`, `+faststart`, `-shortest`, and an explicit video duration to bound silence;
- an external dark caption band (when a track is supplied), even dimensions, and proportional fitting within 1920×1080 without cropping/upscaling. The application's viewport is not resized by captions.

The helper discards source tags/chapters and writes its own format marker so inspection can still label a slideshow. The silent profile worked in the user's Telegram test; this is not a fresh test of Telegram behavior. Export results include `narration: { status, voice, reason }`; don't infer speech just from the presence of an AAC stream. Existing outputs are never overwritten. Keep raw recordings, captions, and speech assets so the video can be rebuilt without another browser run or synthesis. Only audio is assembled before the single final video encode.

## Conditional transport lessons

Only relevant when reusing an existing authorized HTTP relay: file-backed multipart data obtained via `postDataBuffer()` may omit file contents. For a small QA fixture, an in-memory `setInputFiles({ name, mimeType, buffer })` solved this in the recorded trial; do not buffer arbitrary large uploads as a universal rule. A relay may also cancel native browser downloads. An API download can establish saved bytes, but does not establish browser downloading. Report that distinction rather than building a new transport or running extra checks for every quick recording.

Sources: [Playwright video recording](https://playwright.dev/docs/videos), [initialization scripts](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script), [mouse input](https://playwright.dev/docs/api/class-mouse).
