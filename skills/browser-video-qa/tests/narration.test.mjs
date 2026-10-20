import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createSlideshow, convertMedia } from '../scripts/media.mjs';
import { prepareNarration, narrationHoldMs } from '../scripts/narration.mjs';

const execute = promisify(execFile);
const ffmpeg = (...args) => execute('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', ...args], { windowsHide: true });

async function energy(path, start, seconds) {
  const { stdout } = await execute('ffmpeg', ['-v', 'error', '-ss', String(start), '-i', path,
    '-t', String(seconds), '-map', '0:a:0', '-ar', '8000', '-ac', '1', '-f', 's16le', '-'],
  { windowsHide: true, encoding: 'buffer' });
  let total = 0;
  for (let index = 0; index < stdout.length; index += 2) total += Math.abs(stdout.readInt16LE(index));
  assert.ok(stdout.length > 0);
  return total / (stdout.length / 2);
}

test('speech hold respects action time, requested hold, and the 200 ms speech margin', () => {
  assert.equal(narrationHoldMs(2000, { duration: 5 }, 100), 5100);
  assert.equal(narrationHoldMs(2000, { duration: 5 }, 6000), 2000);
  assert.equal(narrationHoldMs(0, undefined, 0), 0);
});

test('narration off needs no runtime or artifacts', async () => {
  assert.deepEqual(await prepareNarration([], { narration: 'off' }), { status: 'off', clips: [] });
});

test('Windows synthesizes Russian and quoted text in one batch; missing voice is an explicit fallback',
  { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-narration-speech-'));
    const text = 'Проверяем «кавычки», путь C:\\temp и текст "$не_команда".';
    const prepared = await prepareNarration([text, 'Настройки сохранены.', text], { dir: join(directory, 'ready') });
    assert.equal(prepared.status, 'ready');
    assert.equal(prepared.voice, 'Microsoft Irina Desktop');
    assert.equal(prepared.clips.length, 2);
    assert.equal(prepared.clips[0].text, text);
    assert.ok(await energy(prepared.clips[0].path, 0, prepared.clips[0].duration) > 50);
    assert.deepEqual(JSON.parse(await readFile(prepared.manifestPath, 'utf8')), prepared);
    const missing = await prepareNarration(['Тест.'], { dir: join(directory, 'missing'), voice: 'Missing QA Voice' });
    assert.equal(missing.status, 'unavailable');
    assert.deepEqual(missing.clips, []);
    assert.ok(missing.reason);
  });

test('video schedules prepared speech without overlap and slideshow extends each frame', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-narration-media-'));
  const video = join(directory, 'source.mp4');
  const image = join(directory, 'slide.png');
  const wave = join(directory, 'tone.wav');
  await ffmpeg('-f', 'lavfi', '-i', 'color=c=teal:size=640x360:rate=25', '-t', '1.2', '-c:v', 'libx264', video);
  await ffmpeg('-i', video, '-frames:v', '1', image);
  await ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050', '-t', '0.3', wave);
  const prepared = { status: 'ready', voice: 'Local test tone', clips: [
    { text: 'Первая фраза', path: wave, duration: 0.3 },
    { text: 'Вторая фраза', path: wave, duration: 0.3 },
  ] };
  const manifest = join(directory, 'narration.json');
  const captions = join(directory, 'captions.json');
  await writeFile(manifest, JSON.stringify(prepared));
  await writeFile(captions, JSON.stringify([{ start: 0.4, end: 1, text: 'Первая фраза' }]));
  const output = join(directory, 'spoken.mp4');
  const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('../scripts/media.mjs', import.meta.url)),
    'convert', video, output, `--captions=${captions}`, `--narration=${manifest}`], { windowsHide: true });
  const result = JSON.parse(stdout);
  assert.equal(result.narration.status, 'ready');
  assert.equal(result.audio.profile, 'LC');
  assert.equal(result.audio.sampleRate, 44100);
  assert.equal(result.audio.channels, 2);
  assert.equal(result.audio.default, true);
  assert.equal(result.videoDefault, true);
  assert.ok(Math.abs(result.videoDuration - result.audio.duration) < 0.05);
  assert.ok(await energy(output, 0, 0.2) < 5);
  assert.ok(await energy(output, 0.48, 0.15) > 100);
  assert.ok(await energy(output, 0.95, 0.15) < 5);
  const slideshow = await createSlideshow(join(directory, 'slides.mp4'), [
    { path: image, text: 'Первая фраза' }, { path: image, text: 'Вторая фраза' },
  ], { seconds: 0.1, narration: prepared });
  assert.equal(slideshow.narration.status, 'ready');
  assert.ok(Math.abs(slideshow.videoDuration - 1) < 0.05);
  assert.ok(await energy(slideshow.path, 0.05, 0.15) > 100);
  assert.ok(await energy(slideshow.path, 0.55, 0.15) > 100);
  const fallback = await convertMedia(video, join(directory, 'no-overlap.mp4'), {
    captions: [{ start: 0, end: 0.1, text: 'Первая фраза' }], narration: prepared,
  });
  assert.equal(fallback.narration.status, 'unavailable');
  assert.ok(await energy(fallback.path, 0, 1) < 5);
  const silent = await convertMedia(video, join(directory, 'off.mp4'), { narration: 'off' });
  assert.equal(silent.narration.status, 'off');
  assert.ok(await energy(silent.path, 0, 1) < 5);
});
