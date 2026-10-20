import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL('../scripts/media.mjs', import.meta.url));
let directory;
let recording;
let firstFrame;
let secondFrame;
let originalMp4;

async function cli(...args) {
  const { stdout } = await execute(process.execPath, [helper, ...args], { windowsHide: true });
  return JSON.parse(stdout);
}

async function ffmpeg(...args) {
  return execute('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', ...args], { windowsHide: true });
}

function rejectsCli(args, message) {
  return assert.rejects(cli(...args), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, message);
    assert.equal(error.stdout, '');
    return true;
  });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser video QA media test '));
  recording = join(directory, "browser recording 'odd size'.webm");
  firstFrame = join(directory, "frame one 'caption'.png");
  secondFrame = join(directory, 'frame two.jpg');
  originalMp4 = join(directory, 'fixture.mp4');
  await ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=101x65:rate=10', '-t', '1.2',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv444p', recording);
  await ffmpeg('-i', recording, '-frames:v', '1', firstFrame);
  await ffmpeg('-i', recording, '-vf', 'negate', '-frames:v', '1', secondFrame);
  await ffmpeg('-i', recording, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', originalMp4);
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('convert handles spaces/quotes and odd sizes, preserves duration, and creates compatible faststart MP4', async t => {
  const output = join(directory, "converted 'browser recording'.mp4");
  const result = await cli('convert', recording, output);
  assert.equal(result.path, output);
  assert.equal(result.kind, 'video');
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.width, 102);
  assert.equal(result.height, 66);
  assert.ok(Math.abs(result.duration - 1.2) < 0.11);
  assert.equal(result.decodeValid, true);
  assert.equal(result.bytes, (await stat(output)).size);
  assert.ok(result.elapsedSeconds > 0);
  const bytes = await readFile(output);
  assert.ok(bytes.indexOf('moov') > 0);
  assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'MP4 moov atom precedes media data');
  const inspected = await cli('inspect', output);
  assert.equal(inspected.decodeValid, true);
  assert.deepEqual(inspected.frames, []);
  t.diagnostic(`convert: ${result.elapsedSeconds}s, ${result.bytes} bytes, ${result.duration}s duration`);
});

test('slideshow accepts mixed still codecs and inspect extracts actual PNG frames', async t => {
  const output = join(directory, 'captioned slideshow.mp4');
  const result = await cli('slideshow', output, firstFrame, secondFrame, '--seconds=0.4');
  assert.equal(result.kind, 'slideshow');
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.width, 102);
  assert.equal(result.height, 66);
  assert.ok(Math.abs(result.duration - 0.8) < 0.08);
  const framesDir = join(directory, 'review frames');
  const inspected = await cli('inspect', output, '--at=0,0.5', `--frames-dir=${framesDir}`);
  assert.equal(inspected.kind, 'slideshow');
  assert.equal(inspected.decodeValid, true);
  assert.deepEqual(inspected.frames.map(frame => frame.time), [0, 0.5]);
  for (const frame of inspected.frames) {
    assert.equal((await readFile(frame.path)).subarray(1, 4).toString(), 'PNG');
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'json', frame.path]);
    assert.deepEqual(JSON.parse(stdout).streams, [{ width: 102, height: 66 }]);
  }
  assert.notDeepEqual(await readFile(inspected.frames[0].path), await readFile(inspected.frames[1].path));
  t.diagnostic(`slideshow: ${result.elapsedSeconds}s, ${result.bytes} bytes, ${result.duration}s duration`);
});

test('inspect default sampling produces three frames, and convert preserves slideshow classification', async () => {
  const slideshow = join(directory, 'single frame.mp4');
  assert.ok(Math.abs((await cli('slideshow', slideshow, firstFrame, '--seconds=0.4')).duration - 0.4) < 0.04);
  const converted = join(directory, 'converted slideshow.mp4');
  assert.equal((await cli('convert', slideshow, converted)).kind, 'slideshow');
  const inspected = await cli('inspect', converted, `--frames-dir=${join(directory, 'default frames')}`);
  assert.equal(inspected.frames.length, 3);
  assert.equal(inspected.frames[0].time, 0);
  assert.ok(inspected.frames[2].time < inspected.duration);
});

test('existing media and frame outputs remain untouched, with extraction collisions checked before publishing', async () => {
  const output = join(directory, 'do not overwrite.mp4');
  await writeFile(output, 'sentinel');
  await rejectsCli(['convert', recording, output], /Refusing to overwrite/);
  await rejectsCli(['slideshow', output, firstFrame], /Refusing to overwrite/);
  assert.equal(await readFile(output, 'utf8'), 'sentinel');
  const framesDir = join(directory, 'collision frames');
  await mkdir(framesDir);
  const secondOutput = join(framesDir, 'frame-002.png');
  await writeFile(secondOutput, 'frame sentinel');
  await rejectsCli(['inspect', originalMp4, '--at=0,0.2', `--frames-dir=${framesDir}`], /Refusing to overwrite/);
  assert.equal(await readFile(secondOutput, 'utf8'), 'frame sentinel');
  await assert.rejects(stat(join(framesDir, 'frame-001.png')), { code: 'ENOENT' });
});

test('invalid numbers/options and out-of-range extraction fail with nonzero status', async () => {
  const output = join(directory, 'invalid number.mp4');
  for (const seconds of ['', '0', '-1', 'Infinity', 'oops']) {
    await rejectsCli(['slideshow', output, firstFrame, `--seconds=${seconds}`], /seconds must be/);
  }
  for (const at of ['', '0,,1', '-1', 'NaN', 'Infinity']) {
    await rejectsCli(['inspect', recording, `--at=${at}`, `--frames-dir=${join(directory, 'invalid frames')}`], /Frame time must be/);
  }
  await rejectsCli(['inspect', recording, '--at=0'], /--at requires --frames-dir/);
  await rejectsCli(['inspect', recording, '--at=1.2', `--frames-dir=${join(directory, 'late frames')}`], /must be less than media duration/);
  await rejectsCli(['convert', recording, output, '--unknown=1'], /Unknown or duplicate option/);
  await rejectsCli(['slideshow', output, firstFrame, '--seconds=1', '--seconds=2'], /Unknown or duplicate option/);
  await rejectsCli(['convert', recording, join(directory, 'wrong.webm')], /Output must have an .mp4 extension/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('invalid inputs and incompatible slideshow dimensions fail without publishing output', async () => {
  const corrupt = join(directory, 'not a recording.webm');
  await writeFile(corrupt, 'corrupt data');
  const output = join(directory, 'corrupt conversion.mp4');
  await rejectsCli(['convert', corrupt, output], /ffprobe exited with code/);
  await rejectsCli(['inspect', corrupt], /ffprobe exited with code/);
  await rejectsCli(['slideshow', output, recording], /Slideshow frame must be a still/);
  const otherSize = join(directory, 'different size.png');
  await ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=64x48', '-frames:v', '1', otherSize);
  await rejectsCli(['slideshow', output, firstFrame, otherSize], /must have equal dimensions/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('full decode rejects a truncated recording even when ffprobe reads its metadata', async () => {
  const bytes = await readFile(originalMp4);
  const truncated = join(directory, 'truncated recording.mp4');
  await writeFile(truncated, bytes.subarray(0, Math.floor(bytes.length * 0.7)));
  // Metadata alone must not be treated as proof that the recording is playable.
  await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', truncated]);
  await rejectsCli(['inspect', truncated], /ffmpeg exited with code/);
  const output = join(directory, 'truncated conversion.mp4');
  await rejectsCli(['convert', truncated, output], /ffmpeg exited with code/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
