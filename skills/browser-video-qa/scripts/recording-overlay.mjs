import { mkdir, access, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { captionScreenshot, inspectMedia } from "./media.mjs";
import { loadNarration, narrationClip, narrationHoldMs } from "./narration.mjs";

function mountOverlay({ captionPosition }) {
  if (window.__browserVideoQaOverlay) return;

  const host = document.createElement("div");
  host.setAttribute("data-browser-video-qa", "");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("popover", "manual");
  host.style.cssText = "all:initial!important;display:block!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; pointer-events: none !important; }
      .pointer { display:none; position:absolute; left:0; top:0; width:28px; height:34px; }
      .pointer svg { position:absolute; width:26px; height:32px; filter:drop-shadow(0 1px 2px #0008); }
      .halo { position:absolute; left:-20px; top:-20px; width:44px; height:44px;
        border:1px solid #b8750088; border-radius:50%; background:#ffbd384d;
        animation:cursor-breathe 1.6s ease-in-out infinite; }
      @keyframes cursor-breathe { from,to { opacity:.65; scale:.9; } 50% { opacity:1; scale:1.12; } }
      .ring { position:absolute; left:-13px; top:-13px; width:30px; height:30px; border:3px solid #0789ff; border-radius:50%; opacity:0; }
      .pointer[data-down="true"] .ring { opacity:1; background:#0789ff44; }
      .pointer[data-down="true"] .halo { animation-play-state:paused; }
      .caption-area { position:absolute; left:24px; right:24px; display:flex; justify-content:center; }
      .caption { display:none; width:fit-content; max-width:min(880px,100%);
        padding:10px 16px; border:1px solid #ffffff88; text-align:center;
        border-radius:8px; background:#111e; color:white; font:clamp(16px,1.5vw,22px)/1.4 Arial,sans-serif;
        overflow-wrap:anywhere; white-space:pre-wrap; box-shadow:0 2px 6px #0008; }
    </style>
    <div class="pointer" data-down="false">
      <div class="halo"></div>
      <div class="ring"></div>
      <svg viewBox="0 0 26 32" aria-hidden="true"><path d="M2 2L2 25L8 19L13 30L18 28L13 17L23 17Z" fill="white" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>
    </div>
    <div class="caption-area"><div class="caption"></div></div>`;
  const pointer = shadow.querySelector(".pointer");
  const ring = shadow.querySelector(".ring");
  const caption = shadow.querySelector(".caption");
  if (captionPosition !== "below") shadow.querySelector(".caption-area").style[captionPosition] = "24px";
  const isTopFrame = window === window.top;
  let captionText;
  let captionAnimation;

  function setCaption(text) {
    if (!isTopFrame || text === captionText) return;
    captionText = text;
    captionAnimation?.cancel();
    captionAnimation = undefined;
    caption.textContent = text;
    caption.style.display = text && captionPosition !== "below" ? "block" : "none";
    if (text && captionPosition !== "below") {
      captionAnimation = caption.animate([
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 200, easing: "ease-out" });
    }
  }

  async function settleCaption() {
    while (captionAnimation) {
      const currentAnimation = captionAnimation;
      try { await currentAnimation.finished; } catch (error) {
        if (captionAnimation === currentAnimation) throw error;
      }
      if (captionAnimation === currentAnimation) return;
    }
  }

  function movePointer(event) {
    if (!event.isTrusted || event.pointerType === "touch") return;
    pointer.style.display = "block";
    pointer.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  }

  function hidePointer() {
    pointer.style.display = "none";
    pointer.dataset.down = "false";
  }

  window.addEventListener("pointermove", movePointer, true);
  window.addEventListener("pointerdown", (event) => {
    movePointer(event);
    if (event.isTrusted && event.pointerType !== "touch") pointer.dataset.down = "true";
  }, true);
  window.addEventListener("pointerup", (event) => {
    if (!event.isTrusted || event.pointerType === "touch") return;
    movePointer(event);
    pointer.dataset.down = "false";
    ring.animate([{ opacity: 1, scale: "0.8" }, { opacity: 0, scale: "1.6" }], { duration: 450 });
  }, true);
  window.addEventListener("pointercancel", hidePointer, true);
  window.addEventListener("blur", hidePointer);
  window.addEventListener("pointerout", (event) => {
    if (event.relatedTarget === null || event.relatedTarget instanceof HTMLIFrameElement) hidePointer();
  }, true);

  function mount() {
    document.documentElement.append(host);
    // A document-layer z-index cannot paint above modal dialogs or native popovers.
    function raiseOverlay() {
      if (!host.isConnected || typeof host.showPopover !== "function") return;
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    }
    raiseOverlay();
    document.addEventListener("toggle", (event) => {
      if (event.target !== host && event.newState === "open") raiseOverlay();
    }, true);
    new MutationObserver((records) => {
      if (records.some(record => record.target instanceof HTMLDialogElement)) raiseOverlay();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
    window.__browserVideoQaOverlay = { setCaption, settleCaption };
    if (isTopFrame) {
      window.__browserVideoQaCaptionForPage().then((text) => {
        if (captionText === undefined) setCaption(text);
      }).catch((error) => {
        console.warn("Browser Video QA caption could not be restored", error.message);
      });
    }
  }

  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

/** Install once on a dedicated recording context; its lifetime owns the overlay. */
export async function installRecordingOverlay(context, { captionPosition = "below", narration } = {}) {
  if (!["below", "top", "bottom"].includes(captionPosition)) throw new Error("captionPosition must be below, top or bottom");
  const speech = await loadNarration(narration);
  const captions = new WeakMap();
  const timelines = new WeakMap();
  function trackPage(page) {
    if (timelines.has(page)) return;
    const timeline = { startedAt: performance.now(), cues: [] };
    timelines.set(page, timeline);
    page.once("close", () => { timeline.endedAt = performance.now(); });
  }
  context.on("page", trackPage);
  for (const page of context.pages()) trackPage(page);
  await context.exposeBinding("__browserVideoQaCaptionForPage", ({ page }) => captions.get(page) ?? "");
  await context.addInitScript(mountOverlay, { captionPosition });
  for (const page of context.pages()) {
    for (const frame of page.frames()) await frame.evaluate(mountOverlay, { captionPosition });
  }

  async function showCaption(page, title) {
    trackPage(page);
    const timeline = timelines.get(page);
    const previous = timeline.cues.at(-1);
    if (!previous || previous.text !== title) {
      const time = (performance.now() - timeline.startedAt) / 1000;
      if (previous) previous.end = time;
      timeline.cues.push({ start: time, text: title });
    }
    captions.set(page, title);
    await page.waitForFunction(() => Boolean(window.__browserVideoQaOverlay));
    await page.evaluate(async (text) => {
      window.__browserVideoQaOverlay.setCaption(text);
      await window.__browserVideoQaOverlay.settleCaption();
    }, title);
  }

  async function capture(page, path) {
    const output = resolve(path);
    await mkdir(dirname(output), { recursive: true });
    let exists = false;
    try { await access(output); exists = true; } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (exists) throw new Error(`Screenshot already exists: ${output}`);
    await page.waitForFunction(() => Boolean(window.__browserVideoQaOverlay));
    await page.evaluate(() => window.__browserVideoQaOverlay.settleCaption());
    if (captionPosition === "below") {
      await captionScreenshot(await page.screenshot(), output, captions.get(page) ?? "");
    } else {
      await page.screenshot({ path: output });
    }
    return output;
  }

  async function saveCaptions(page, path, { offsetSeconds = 0 } = {}) {
    if (!Number.isFinite(offsetSeconds)) throw new Error("offsetSeconds must be finite");
    trackPage(page);
    const timeline = timelines.get(page);
    const end = ((timeline.endedAt ?? performance.now()) - timeline.startedAt) / 1000;
    let finalEnd = end;
    if (page.video()) {
      if (!page.isClosed()) throw new Error("Close the recording context before saving video captions");
      const { videoDuration } = await inspectMedia(await page.video().path());
      // Encoding may repeat the final frame. Extend only its caption; this tail
      // must not shift earlier captions away from the UI actions they describe.
      finalEnd = Math.max(end, videoDuration);
    }
    const cues = timeline.cues.map(cue => ({
      start: Math.max(0, cue.start + offsetSeconds),
      end: Math.max(0, (cue.end ?? finalEnd) + offsetSeconds),
      text: cue.text,
    })).filter(cue => cue.end > cue.start);
    const output = resolve(path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(cues, null, 2), { flag: "wx" });
    return output;
  }

  async function step(page, title, action, { holdMs = 2000, screenshotPath, target } = {}) {
    if (!Number.isFinite(holdMs) || holdMs < 0) throw new Error("holdMs must be non-negative");
    const startedAt = performance.now();
    await showCaption(page, title);
    let targetDecoration;
    try {
      if (target) {
        await target.waitFor({ state: "visible" });
        targetDecoration = await target.evaluateHandle((element) => {
          // A filled animation overrides the outline without rewriting application styles.
          const decoration = element.animate([
            { outline: "3px solid #ffb84d", outlineOffset: "4px" },
            { outline: "3px solid #ffb84d", outlineOffset: "4px" },
          ], { duration: 1, fill: "forwards" });
          decoration.finish();
          return decoration;
        });
      }
      const result = await action();
      await showCaption(page, title);
      // Slideshow capture stays fast; its speech-dependent durations are set at export.
      const clip = page.video() ? narrationClip(speech, title) : undefined;
      await delay(narrationHoldMs(holdMs, clip, performance.now() - startedAt));
      if (screenshotPath) await capture(page, screenshotPath);
      return result;
    } catch (error) {
      try {
        await showCaption(page, `FAILED: ${title}`);
        await delay(holdMs);
      } catch (annotationError) {
        process.stderr.write(`Could not annotate failed step: ${annotationError.message}\n`);
      }
      throw error;
    } finally {
      if (targetDecoration) {
        try {
          await targetDecoration.evaluate((decoration) => decoration.cancel());
        } catch (error) {
          // Navigation or page closure already removed the decorated document.
          if (!/Execution context was destroyed|Cannot find context|has been closed|Frame was detached/i.test(error.message)) {
            process.stderr.write(`Could not remove target decoration: ${error.message}\n`);
          }
        } finally {
          try { await targetDecoration.dispose(); } catch (error) {
            process.stderr.write(`Could not release target decoration: ${error.message}\n`);
          }
        }
      }
    }
  }

  return { step, capture, saveCaptions };
}
