import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { captionScreenshot, convertMedia } from '../scripts/media.mjs';

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
  assert.equal(result.decodeValid, null);
  assert.equal(result.verification, 'metadata');
  assert.equal(result.mode, 'quick');
  assert.equal(result.profile, 'Main');
  assert.equal(result.level, 40);
  assert.equal(result.fps, 25);
  assert.equal(result.videoTag, 'avc1');
  assert.equal(result.videoDefault, true);
  assert.equal(result.brand, 'mp42');
  assert.equal(result.audio.codec, 'aac');
  assert.equal(result.audio.profile, 'LC');
  assert.equal(result.audio.sampleRate, 44100);
  assert.equal(result.audio.channels, 2);
  assert.equal(result.audio.default, true);
  assert.ok(Math.abs(result.audio.duration - result.duration) < 0.1);
  assert.equal(result.bytes, (await stat(output)).size);
  assert.ok(result.elapsedSeconds > 0);
  const bytes = await readFile(output);
  assert.ok(bytes.indexOf('moov') > 0);
  assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'MP4 moov atom precedes media data');
  const inspected = await cli('inspect', output, '--mode=strict');
  assert.equal(inspected.decodeValid, true);
  assert.equal(inspected.verification, 'full');
  assert.deepEqual(inspected.frames, []);
  t.diagnostic(`convert: ${result.elapsedSeconds}s, ${result.bytes} bytes, ${result.duration}s duration`);
});

test('slideshow accepts mixed still codecs and inspect extracts actual PNG frames', async t => {
  const output = join(directory, 'captioned slideshow.mp4');
  const result = await cli('slideshow', output, firstFrame, secondFrame, '--seconds=0.4');
  assert.equal(result.kind, 'slideshow');
  assert.equal(result.codec, 'h264');
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.fps, 25);
  assert.equal(result.profile, 'Main');
  assert.equal(result.audio.profile, 'LC');
  assert.equal(result.audio.default, true);
  assert.equal(result.width, 102);
  assert.equal(result.height, 66);
  assert.ok(Math.abs(result.duration - 0.8) < 0.08);
  const framesDir = join(directory, 'review frames');
  const inspected = await cli('inspect', output, '--at=0,0.5', `--frames-dir=${framesDir}`);
  assert.equal(inspected.verification, 'sampled');
  assert.equal(inspected.decodeValid, null);
  assert.equal(inspected.kind, 'slideshow');
  assert.equal(inspected.decodeValid, null);
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
  const quick = await cli('inspect', truncated);
  assert.equal(quick.decodeValid, null);
  assert.equal(quick.verification, 'metadata');
  await rejectsCli(['inspect', truncated, '--mode=strict'], /ffmpeg exited with code/);
  const output = join(directory, 'truncated conversion.mp4');
  await rejectsCli(['convert', truncated, output, '--mode=strict'], /ffmpeg exited with code/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('export replaces audible input with actual silence, removes old tags/chapters and marks both tracks default', async () => {
  const metadata = join(directory, 'old-metadata.txt');
  await writeFile(metadata, ';FFMETADATA1\ntitle=old private title\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=old chapter\n');
  const source = join(directory, 'audible-source.mp4');
  await ffmpeg('-i', originalMp4, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-f', 'ffmetadata', '-i', metadata, '-map', '0:v:0', '-map', '1:a:0',
    '-map_metadata', '2', '-map_chapters', '2', '-metadata:s:v:0', 'title=old video title',
    '-c:v', 'copy', '-c:a', 'aac', '-t', '1.2', source);
  const output = join(directory, 'silent-output.mp4');
  const result = await convertMedia(source, output, { mode: 'strict' });
  assert.equal(result.decodeValid, true);
  const { stdout: pcm } = await execute('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:a:0',
    '-c:a', 'pcm_s16le', '-f', 's16le', '-'], { encoding: 'buffer', windowsHide: true });
  assert.ok(pcm.length > 10000);
  assert.ok(pcm.every(byte => byte === 0), 'AAC decodes to complete silence');
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_chapters', '-show_format', '-show_streams', '-of', 'json', output]);
  const data = JSON.parse(stdout);
  assert.equal(data.format.tags.title, undefined);
  assert.equal(data.streams[0].tags?.title, undefined);
  assert.deepEqual(data.chapters, []);
  assert.deepEqual(data.streams.map(stream => stream.disposition.default), [1, 1]);
  assert.ok(Math.abs(Number(data.streams[0].duration) - Number(data.streams[1].duration)) < 0.1);
});

test('external Russian captions leave screenshot viewport pixels intact and are timed in video', async () => {
  const image = join(directory, 'viewport.png');
  await ffmpeg('-f', 'lavfi', '-i', 'color=c=teal:size=640x360', '-frames:v', '1', image);
  const screenshot = join(directory, 'caption-below.png');
  await captionScreenshot(await readFile(image), screenshot, 'Русская подпись под кадром\nВторая строка не закрывает интерфейс');
  const pixels = async path => (await execute('ffmpeg', ['-v', 'error', '-i', path,
    '-vf', 'crop=640:360:0:0,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', windowsHide: true })).stdout;
  assert.deepEqual(await pixels(screenshot), await pixels(image));
  const literal = join(directory, 'literal-caption.png');
  await captionScreenshot(await readFile(image), literal, 'Буквальный текст {\\clip(0,0,640,360)\\pos(100,100)}');
  assert.deepEqual(await pixels(literal), await pixels(image), 'caption text cannot move into the viewport');
  const input = join(directory, 'caption-input.mp4');
  await ffmpeg('-loop', '1', '-i', image, '-t', '1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input);
  const track = join(directory, 'captions.json');
  await writeFile(track, JSON.stringify([{ start: 0.2, end: 0.8, text: 'Подпись только в середине' }]));
  const output = join(directory, 'caption-video.mp4');
  const result = await cli('convert', input, output, `--captions=${track}`);
  assert.equal(result.width, 640);
  assert.equal(result.height, 456);
  const { frames } = await cli('inspect', output, '--at=0.08,0.4,1.04', `--frames-dir=${join(directory, 'caption-frames')}`);
  const band = async path => (await execute('ffmpeg', ['-v', 'error', '-i', path,
    '-vf', 'crop=640:96:0:360,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', windowsHide: true })).stdout;
  const lit = bytes => bytes.filter(value => value > 180).length;
  assert.equal(lit(await band(frames[0].path)), 0);
  assert.ok(lit(await band(frames[1].path)) > 200);
  assert.equal(lit(await band(frames[2].path)), 0);
});

test('large compositions fit Main 4.0 dimensions without cropping', async () => {
  const input = join(directory, 'large.mp4');
  await ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:size=2048x1200:rate=25', '-t', '0.2', '-c:v', 'libx264', input);
  const result = await convertMedia(input, join(directory, 'fitted.mp4'), {
    captions: [{ start: 0, end: 0.2, text: 'Подпись под большим кадром' }],
  });
  assert.ok(result.width <= 1920 && result.height <= 1080);
  assert.ok(Math.abs(result.width / result.height - 2048 / (1200 + 136)) < 0.01);
  assert.equal(result.level, 40);
});

test('invalid modes and caption intervals are rejected before output is published', async () => {
  const output = join(directory, 'bad-options.mp4');
  await rejectsCli(['convert', recording, output, '--mode=slow'], /mode must be/);
  await assert.rejects(convertMedia(recording, output, { captions: [{ start: 1, end: 0.5, text: 'bad' }] }), /ordered/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
