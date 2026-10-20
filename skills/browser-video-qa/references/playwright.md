# Playwright recording

Use this path when Playwright is an allowed browser tool. Requires Node.js, an existing Playwright installation/browser, and `ffmpeg` / `ffprobe` on PATH. The recording API works with Playwright 1.58.2. Do not upgrade application dependencies just for recording. If these facilities are unavailable, use the permitted screenshot tool and label the result a slideshow.

## Ordinary scenario script

Resolve Playwright from the project that already has it, rather than installing packages inside the skill. Pass real absolute paths for `PROJECT_DIR`, `SKILL_DIR`, and `ARTIFACT_DIR`; keep artifacts outside the repository. Reuse the project's authorized authentication mechanism; do not print or publish cookies/storage state. The example deliberately leaves application locators and assertions to the task.

```js
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const require = createRequire(join(PROJECT_DIR, "package.json"));
const { chromium } = require("playwright");
const format = "video"; // Honor the request: "video", "slideshow", or "both".
const { installRecordingOverlay } = await import(pathToFileURL(
  join(SKILL_DIR, "scripts/recording-overlay.mjs"),
));
await mkdir(ARTIFACT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: format === "slideshow" ? undefined
    : { dir: ARTIFACT_DIR, size: { width: 1440, height: 900 } },
});
let video;
try {
  const demo = await installRecordingOverlay(context, { captionPosition: "bottom" });
  const page = await context.newPage();
  video = page.video();
  await page.goto(TARGET_URL);
  await demo.step(page, "Enter and save the new value", async () => {
    // Locate controls, act through UI input, and assert the actual result here.
  }, { screenshotPath: join(ARTIFACT_DIR, "01-saved.png") });
  await demo.step(page, "Reopen and verify the saved value", async () => {
    await page.reload();
    // Assert the reopened UI and read saved API/file data if needed.
  }, { screenshotPath: join(ARTIFACT_DIR, "02-reopened.png") });
} finally {
  // Context closure finalizes the file even when an assertion throws.
  try { await context.close(); } finally { await browser.close(); }
}
if (video) process.stdout.write(`${await video.path()}\n`);
```

Use a dedicated context owned by the run. A context may be annotated after creation, but install before navigating when possible. The helper lasts for that context's lifetime. `step` restores captions across ordinary navigation, holds the final state for two seconds by default, and rethrows failed checks. `capture` takes an additional screenshot without changing application animations. Choose top or bottom captions so they do not cover the feature.

Plan the key states before writing the script. In video mode, `step` keeps recording while the UI changes, then holds the checked result so the viewer can read it. In slideshow mode, omit `recordVideo`, use `holdMs: 0` once the page is ready for capture, and assemble just the ordered checkpoint images with an appropriate `--seconds` viewing duration. In both mode, reuse those same checkpoints from the continuous run. No automatic editing, frame freezing, or separate scenario language is needed.

The pointer is a high-contrast visual overlay driven by actual trusted pointer events, not the desktop cursor or a guessed path. For readable dragging, send intermediate real moves with brief delays while the button is held:

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

Do not inject fake pointer events or application state. Touch input has no mouse pointer. Browser chrome, native dialogs, desktop windows, pointer-lock/fullscreen behavior, and physical mobile/headset displays are not established by this recording. Inspect cursor visibility rather than assume an unusual page or embedded frame supports it. Popups have separate page recordings; deliver them as separate clips if needed, not a fabricated single-page recording.

## Media commands

```text
node <SKILL_DIR>/scripts/media.mjs convert <raw.webm> <result.mp4>
node <SKILL_DIR>/scripts/media.mjs inspect <result.mp4> --at=1,5,5.2,5.4,10 --frames-dir=<frames-directory>
node <SKILL_DIR>/scripts/media.mjs slideshow <slideshow.mp4> <01.png> <02.png> --seconds=3
```

Quote paths containing spaces in your shell. `convert` produces H.264 / yuv420p MP4 with fast-start metadata. `inspect` fully decodes the file, returns metadata, and optionally extracts frames at requested seconds; inspect a tighter sequence around dragging. Without `--at`, `--frames-dir` extracts the beginning, midpoint, and end. Those three frames are a starting point, not complete acceptance evidence. Generated outputs are not overwritten.

Slideshow inputs must be screenshots with the same dimensions and already contain any required captions/pointer. Name and describe that output as a **slideshow**, even though its container is MP4. Frame extraction validates media, not feature correctness; the agent must view the extracted images and compare with the actual checks. Report elapsed processing time and file size when useful; recording overhead depends on the page and machine and is not a performance benchmark.

Sources: [Playwright video recording](https://playwright.dev/docs/videos), [initialization scripts](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script), [mouse input](https://playwright.dev/docs/api/class-mouse).
