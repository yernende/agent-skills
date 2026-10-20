import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { installRecordingOverlay } from "../scripts/recording-overlay.mjs";
import { startFixture } from "./fixture.mjs";

const require = createRequire(join(process.env.PLAYWRIGHT_PROJECT_DIR || process.cwd(), "package.json"));
const { chromium, expect } = require("@playwright/test");
const mediaPath = fileURLToPath(new URL("../scripts/media.mjs", import.meta.url));

function media(...args) {
  return JSON.parse(execFileSync(process.execPath, [mediaPath, ...args], { encoding: "utf8" }));
}

test("record real input, dragging, HTTP persistence and a failed assertion", { timeout: 120000 }, async () => {
  const artifacts = process.env.BROWSER_VIDEO_QA_ARTIFACT_DIR
    ? resolve(process.env.BROWSER_VIDEO_QA_ARTIFACT_DIR)
    : await mkdtemp(join(tmpdir(), "browser-video-qa-"));
  await mkdir(artifacts, { recursive: true });
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  const started = performance.now();
  const screenshots = [];
  let rawVideo;
  let savedPosition;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: join(artifacts, "raw"), size: { width: 1440, height: 900 } },
    });
    try {
      const demo = await installRecordingOverlay(context, { captionPosition: "top" });
      const page = await context.newPage();
      rawVideo = page.video();
      await page.goto(fixture.url);
      await expect(page.locator("#status")).toHaveText("Данные загружены");
      const screenshot = (name) => {
        const path = join(artifacts, `${name}.png`);
        screenshots.push(path);
        return path;
      };

      await demo.step(page, "1. Исходное состояние: положение 20%", async () => {
        await page.mouse.move(330, 350);
        await expect(page.locator("#position")).toHaveText("20");
        assert.equal(await page.locator("[data-browser-video-qa]").evaluate(element => getComputedStyle(element).pointerEvents), "none");
      }, { holdMs: 2200, screenshotPath: screenshot("01-initial") });

      await demo.step(page, "2. Вводим название обычным клавиатурным вводом", async () => {
        const input = page.getByRole("textbox", { name: "Название проверки" });
        await input.click();
        await input.fill("");
        await input.pressSequentially("Проверено через браузер", { delay: 65 });
        await expect(input).toHaveValue("Проверено через браузер");
      }, { holdMs: 2000, screenshotPath: screenshot("02-input") });

      await demo.step(page, "3. Перетаскиваем маркер: кольцо показывает удержание кнопки", async () => {
        const handle = await page.getByRole("button", { name: "Маркер положения" }).boundingBox();
        const surface = await page.locator("#surface").boundingBox();
        const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
        const end = { x: surface.x + surface.width * 0.75, y: start.y };
        await page.mouse.move(start.x, start.y);
        await delay(500);
        await page.mouse.down();
        for (let index = 1; index <= 35; index++) {
          await page.mouse.move(start.x + (end.x - start.x) * index / 35, start.y);
          await delay(45);
          if (index === 18) await demo.capture(page, screenshot("03-drag-held"));
        }
        await page.mouse.up();
        savedPosition = Number(await page.locator("#position").textContent());
        assert.equal(savedPosition, 75);
      }, { holdMs: 2200, screenshotPath: screenshot("04-drag-result") });

      await demo.step(page, "4. Проверяем видимость курсора на тёмном фоне", async () => {
        const dark = await page.locator("#dark").boundingBox();
        await page.mouse.move(dark.x + dark.width / 2, dark.y + dark.height / 2, { steps: 20 });
      }, { holdMs: 2200, screenshotPath: screenshot("05-dark-cursor") });

      await demo.step(page, "5. Прокручиваем страницу и сохраняем через настоящий HTTP", async () => {
        await page.mouse.wheel(0, 650);
        await page.getByRole("button", { name: "Сохранить через HTTP" }).click();
        await expect(page.locator("#status")).toHaveText("Сохранено через HTTP");
        const response = await context.request.get(`${fixture.url}/api/state`);
        assert.equal(response.status(), 200);
        assert.deepEqual(await response.json(), { name: "Проверено через браузер", position: 75 });
      }, { holdMs: 2400, screenshotPath: screenshot("06-http-saved") });

      await demo.step(page, "6. Перезагрузка: название и положение прочитаны из API заново", async () => {
        await page.reload();
        await expect(page.locator("#status")).toHaveText("Данные загружены");
        await expect(page.getByRole("textbox")).toHaveValue("Проверено через браузер");
        await expect(page.locator("#position")).toHaveText("75");
        assert.equal(await page.locator("[data-browser-video-qa]").count(), 1);
        await page.mouse.wheel(0, -900);
        await page.mouse.move(340, 360);
      }, { holdMs: 2600, screenshotPath: screenshot("07-reloaded") });

      await demo.step(page, "7. Курсор и подпись видны над обычным HTML-диалогом", async () => {
        await page.getByRole("button", { name: "Открыть диалог" }).click();
        const checkbox = page.getByRole("checkbox", { name: "Ввод в диалоге работает" });
        await checkbox.check();
        await expect(checkbox).toBeFocused();
        const bounds = await checkbox.boundingBox();
        await page.mouse.move(bounds.x + 12, bounds.y + 12);
        await delay(500);
        await demo.capture(page, screenshot("08-modal"));
        await page.getByRole("button", { name: "Закрыть диалог" }).click();
        await page.mouse.wheel(0, -1000);
      }, { holdMs: 1800, screenshotPath: screenshot("09-complete") });

      await assert.rejects(demo.capture(page, screenshots[0]), /already exists/);
    } finally {
      await context.close();
    }

    const failureContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: join(artifacts, "failed-raw"), size: { width: 1440, height: 900 } },
    });
    let failureVideo;
    try {
      const demo = await installRecordingOverlay(failureContext, { captionPosition: "top" });
      const page = await failureContext.newPage();
      failureVideo = page.video();
      await page.goto(fixture.url);
      await expect(page.locator("#status")).toHaveText("Данные загружены");
      await assert.rejects(demo.step(page, "Контроль ошибки: пустое название отклоняется сервером", async () => {
        await page.getByRole("textbox").fill("");
        await page.getByRole("button", { name: "Сохранить через HTTP" }).click();
        await expect(page.locator("#status")).toHaveText("Ошибка сохранения");
        const response = await failureContext.request.get(`${fixture.url}/api/state`);
        assert.equal((await response.json()).name, "Проверено через браузер");
        throw new Error("Intentional assertion failure for recording validation");
      }, { holdMs: 1700 }), /Intentional assertion failure/);
      await demo.capture(page, join(artifacts, "failed-step.png"));
    } finally {
      await failureContext.close();
    }

    const result = media("convert", await rawVideo.path(), join(artifacts, "browser-video-qa-demo.mp4"));
    const inspected = media("inspect", result.path, `--frames-dir=${join(artifacts, "frames")}`);
    const slideshow = media("slideshow", join(artifacts, "browser-video-qa-slideshow.mp4"), ...screenshots.toSorted(), "--seconds=2");
    const failed = media("convert", await failureVideo.path(), join(artifacts, "browser-video-qa-failure.mp4"));
    media("inspect", failed.path);
    assert.equal(inspected.decodeValid, true);
    assert.equal(slideshow.kind, "slideshow");
    assert.ok((await stat(result.path)).size > 0);
    process.stdout.write(`${JSON.stringify({ artifacts, totalSeconds: (performance.now() - started) / 1000, result, slideshow, savedPosition, screenshots }, null, 2)}\n`);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("requested slideshow captures verified key states without recording video", { timeout: 60000 }, async () => {
  const artifacts = process.env.BROWSER_VIDEO_QA_ARTIFACT_DIR
    ? join(resolve(process.env.BROWSER_VIDEO_QA_ARTIFACT_DIR), "slideshow-only")
    : await mkdtemp(join(tmpdir(), "browser-video-qa-slides-"));
  await mkdir(artifacts, { recursive: true });
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const demo = await installRecordingOverlay(context, { captionPosition: "top" });
    const page = await context.newPage();
    assert.equal(page.video(), null);
    await page.goto(fixture.url);
    await expect(page.locator("#status")).toHaveText("Данные загружены");
    const checkpoints = ["01-initial.png", "02-saved.png", "03-reloaded.png"].map(name => join(artifacts, name));
    await demo.step(page, "1. Слайд-шоу: исходное состояние", async () => {
      await page.mouse.move(330, 420);
      await expect(page.locator("#position")).toHaveText("20");
    }, { holdMs: 0, screenshotPath: checkpoints[0] });
    await demo.step(page, "2. Название изменено и сохранено через HTTP", async () => {
      await page.getByRole("textbox").fill("Только слайд-шоу");
      await page.getByRole("button", { name: "Сохранить через HTTP" }).click();
      await expect(page.locator("#status")).toHaveText("Сохранено через HTTP");
    }, { holdMs: 0, screenshotPath: checkpoints[1] });
    await demo.step(page, "3. После перезагрузки данные совпадают с API", async () => {
      await page.reload();
      await expect(page.getByRole("textbox")).toHaveValue("Только слайд-шоу");
      const response = await context.request.get(`${fixture.url}/api/state`);
      assert.deepEqual(await response.json(), { name: "Только слайд-шоу", position: 20 });
      await page.mouse.wheel(0, -1000);
      await page.mouse.move(340, 420);
    }, { holdMs: 0, screenshotPath: checkpoints[2] });
    const slideshow = media("slideshow", join(artifacts, "requested-slideshow.mp4"), ...checkpoints, "--seconds=3");
    assert.equal(slideshow.kind, "slideshow");
    assert.equal(slideshow.duration, 9);
    assert.equal(page.video(), null);
    process.stdout.write(`${JSON.stringify({ requestedFormat: "slideshow", slideshow, recordedVideo: false }, null, 2)}\n`);
  } finally {
    try { await context.close(); } finally {
      await browser.close();
      await fixture.close();
    }
  }
});
