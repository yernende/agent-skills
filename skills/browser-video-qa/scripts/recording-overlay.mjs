import { mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
      .ring { position:absolute; left:-13px; top:-13px; width:30px; height:30px; border:3px solid #0789ff; border-radius:50%; opacity:0; }
      .pointer[data-down="true"] .ring { opacity:1; background:#0789ff44; }
      .caption { display:none; position:absolute; left:20px; right:20px; width:fit-content;
        max-width:calc(100% - 40px); padding:10px 16px; border:1px solid #ffffff88;
        border-radius:8px; background:#111e; color:white; font:18px/1.4 Arial,sans-serif;
        overflow-wrap:anywhere; white-space:pre-wrap; box-shadow:0 2px 6px #0008; }
    </style>
    <div class="pointer" data-down="false">
      <div class="ring"></div>
      <svg viewBox="0 0 26 32" aria-hidden="true"><path d="M2 2L2 25L8 19L13 30L18 28L13 17L23 17Z" fill="white" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>
    </div>
    <div class="caption"></div>`;
  const pointer = shadow.querySelector(".pointer");
  const ring = shadow.querySelector(".ring");
  const caption = shadow.querySelector(".caption");
  caption.style[captionPosition] = "20px";
  const isTopFrame = window === window.top;

  function setCaption(text) {
    if (!isTopFrame) return;
    caption.textContent = text;
    caption.style.display = text ? "block" : "none";
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
    window.__browserVideoQaOverlay = { setCaption };
    if (isTopFrame) {
      window.__browserVideoQaCaptionForPage().then(setCaption).catch((error) => {
        console.warn("Browser Video QA caption could not be restored", error.message);
      });
    }
  }

  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

/** Install once on a dedicated recording context; its lifetime owns the overlay. */
export async function installRecordingOverlay(context, { captionPosition = "bottom" } = {}) {
  if (!["top", "bottom"].includes(captionPosition)) throw new Error("captionPosition must be top or bottom");
  const captions = new WeakMap();
  await context.exposeBinding("__browserVideoQaCaptionForPage", ({ page }) => captions.get(page) ?? "");
  await context.addInitScript(mountOverlay, { captionPosition });
  for (const page of context.pages()) {
    for (const frame of page.frames()) await frame.evaluate(mountOverlay, { captionPosition });
  }

  async function showCaption(page, title) {
    captions.set(page, title);
    await page.waitForFunction(() => Boolean(window.__browserVideoQaOverlay));
    await page.evaluate((text) => window.__browserVideoQaOverlay.setCaption(text), title);
  }

  async function capture(page, path) {
    const output = resolve(path);
    await mkdir(dirname(output), { recursive: true });
    let exists = false;
    try { await access(output); exists = true; } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (exists) throw new Error(`Screenshot already exists: ${output}`);
    await page.screenshot({ path: output });
    return output;
  }

  async function step(page, title, action, { holdMs = 2000, screenshotPath } = {}) {
    if (!Number.isFinite(holdMs) || holdMs < 0) throw new Error("holdMs must be non-negative");
    await showCaption(page, title);
    try {
      const result = await action();
      await showCaption(page, title);
      await delay(holdMs);
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
    }
  }

  return { step, capture };
}
