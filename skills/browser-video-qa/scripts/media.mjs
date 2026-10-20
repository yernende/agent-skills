#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `Usage:
  node media.mjs convert INPUT OUTPUT.mp4
  node media.mjs slideshow OUTPUT.mp4 FRAME... [--seconds=3]
  node media.mjs inspect INPUT [--at=0,1.2,3] [--frames-dir=ABS_DIR]

Requires ffmpeg and ffprobe on PATH. Existing outputs are never overwritten.
Slideshow frames must be still PNG/JPEG/WebP/BMP images with equal dimensions.
--at requires --frames-dir. With only --frames-dir, extracts start/middle/end.
`;

function run(binary, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', error => reject(new Error(`${binary}: ${error.message}`, { cause: error })));
    child.on('close', code => {
      if (code === 0) resolveResult(stdout);
      else reject(new Error(`${binary} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function finiteNumber(value, name, allowZero = false) {
  if (String(value).trim() === '') throw new Error(`${name} must be a number.`);
  const result = Number(value);
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) {
    throw new Error(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return result;
}

async function inputFile(path) {
  const absolutePath = resolve(path);
  if (!(await stat(absolutePath)).isFile()) throw new Error(`Input is not a file: ${absolutePath}`);
  return absolutePath;
}

async function refuseExisting(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing output: ${path}`);
}

async function probe(path) {
  const json = await run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
    'format=duration,format_name:format_tags=comment:stream=codec_type,codec_name,pix_fmt,width,height,duration,avg_frame_rate',
    '-of', 'json', path,
  ]);
  const data = JSON.parse(json);
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  if (!video || !(video.width > 0 && video.height > 0)) throw new Error(`No video/image stream in ${path}`);
  return { format: data.format ?? {}, video };
}

async function decode(path) {
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-err_detect', 'explode',
    '-protocol_whitelist', 'file,pipe', '-i', path, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-',
  ]);
}

function videoInfo(path, data, bytes) {
  const duration = finiteNumber(data.format.duration ?? data.video.duration, 'Media duration');
  return {
    path,
    kind: data.format.tags?.comment === 'browser-video-qa:slideshow' ? 'slideshow' : 'video',
    duration,
    width: data.video.width,
    height: data.video.height,
    bytes,
    codec: data.video.codec_name,
    pixelFormat: data.video.pix_fmt,
  };
}

async function inspectVideo(path) {
  const data = await probe(path);
  const info = videoInfo(path, data, (await stat(path)).size);
  await decode(path);
  return { info, data };
}

function elapsedSince(start) {
  return Number(((performance.now() - start) / 1000).toFixed(3));
}

async function createOutput(output, encode) {
  const absoluteOutput = resolve(output);
  if (!absoluteOutput.toLowerCase().endsWith('.mp4')) throw new Error('Output must have an .mp4 extension.');
  await refuseExisting(absoluteOutput);
  const scratch = await mkdtemp(join(tmpdir(), 'browser-video-qa-media-'));
  try {
    const temporaryOutput = join(scratch, 'output.mp4');
    await encode(temporaryOutput, scratch);
    const { info } = await inspectVideo(temporaryOutput);
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await copyFile(temporaryOutput, absoluteOutput, constants.COPYFILE_EXCL);
    return { ...info, path: absoluteOutput, decodeValid: true };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const padFilter = 'pad=ceil(iw/2)*2:ceil(ih/2)*2';
const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

/** Convert a local browser recording to a compatible MP4 without changing its timing. */
export async function convertMedia(input, output) {
  const start = performance.now();
  const source = await inputFile(input);
  const sourceData = await probe(source);
  const kind = sourceData.format.tags?.comment === 'browser-video-qa:slideshow' ? 'slideshow' : 'video';
  const result = await createOutput(output, async temporaryOutput => {
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-err_detect', 'explode',
      '-protocol_whitelist', 'file,pipe', '-i', source, '-map', '0:v:0', '-an', '-vf', padFilter, ...h264,
      '-metadata', `comment=browser-video-qa:${kind}`, temporaryOutput,
    ]);
  });
  return { ...result, elapsedSeconds: elapsedSince(start) };
}

/** Assemble already-captioned stills. This output cannot demonstrate continuous motion. */
export async function createSlideshow(output, frames, { seconds = 3 } = {}) {
  const start = performance.now();
  const frameSeconds = finiteNumber(seconds, 'seconds');
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('At least one slideshow frame is required.');
  const duration = finiteNumber(frameSeconds * frames.length, 'Total slideshow duration');
  const sources = [];
  let dimensions;
  for (const frame of frames) {
    const source = await inputFile(frame);
    const { video, format } = await probe(source);
    if (!['png', 'mjpeg', 'webp', 'bmp'].includes(video.codec_name)
      || !['image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe'].includes(format.format_name)) {
      throw new Error(`Slideshow frame must be a still PNG/JPEG/WebP/BMP image: ${source}`);
    }
    const size = `${video.width}x${video.height}`;
    if (dimensions && dimensions !== size) throw new Error(`Slideshow frames must have equal dimensions (${dimensions} vs ${size}).`);
    dimensions = size;
    sources.push({ path: source, codec: video.codec_name });
  }
  const result = await createOutput(output, async (temporaryOutput, scratch) => {
    const entries = [];
    for (const [index, source] of sources.entries()) {
      // Generated names keep user paths (including spaces and quotes) out of concat syntax.
      const name = `frame-${index}.png`;
      if (source.codec === 'png') await copyFile(source.path, join(scratch, name));
      else await run('ffmpeg', [
        '-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-protocol_whitelist', 'file,pipe',
        '-i', source.path, '-frames:v', '1', join(scratch, name),
      ]);
      entries.push(`file '${name}'`, `duration ${frameSeconds}`);
    }
    entries.push(`file 'frame-${sources.length - 1}.png'`);
    const manifest = join(scratch, 'frames.txt');
    await writeFile(manifest, `${entries.join('\n')}\n`);
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-f', 'concat', '-safe', '0',
      '-protocol_whitelist', 'file,pipe', '-i', manifest, '-t', String(duration), '-an',
      '-vf', `fps=30,${padFilter}`, ...h264,
      '-metadata', 'comment=browser-video-qa:slideshow', temporaryOutput,
    ]);
  });
  return { ...result, elapsedSeconds: elapsedSince(start) };
}

/** Decode the complete file and optionally extract frames for human visual review. */
export async function inspectMedia(input, { at, framesDir } = {}) {
  const start = performance.now();
  if (at !== undefined && !framesDir) throw new Error('--at requires --frames-dir.');
  if (at !== undefined && (!Array.isArray(at) || at.length === 0)) throw new Error('at must contain at least one frame time.');
  const requestedTimes = at?.map(time => finiteNumber(time, 'Frame time', true));
  const source = await inputFile(input);
  const { info, data } = await inspectVideo(source);
  const frames = [];
  if (framesDir) {
    const directory = resolve(framesDir);
    const [numerator, denominator] = String(data.video.avg_frame_rate).split('/').map(Number);
    const rate = denominator > 0 ? numerator / denominator : 0;
    const endTime = Math.max(0, info.duration - Math.max(rate > 0 ? 1 / rate : 0, 0.1));
    const times = requestedTimes ?? [0, info.duration / 2, endTime];
    for (const [index, time] of times.entries()) {
      if (time >= info.duration) throw new Error(`Frame time ${time} must be less than media duration ${info.duration}.`);
      const path = join(directory, `frame-${String(index + 1).padStart(3, '0')}.png`);
      await refuseExisting(path);
      frames.push({ time, path });
    }
    const scratch = await mkdtemp(join(tmpdir(), 'browser-video-qa-frames-'));
    try {
      for (const [index, frame] of frames.entries()) {
        const temporaryFrame = join(scratch, `${index}.png`);
        await run('ffmpeg', [
          '-hide_banner', '-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe',
          '-i', source, '-ss', String(frame.time), '-frames:v', '1', temporaryFrame,
        ]);
        // FFmpeg can exit successfully without writing a frame when seeking beyond the last PTS.
        try { await stat(temporaryFrame); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          throw new Error(`No frame decoded at ${frame.time}s; choose an earlier frame time.`);
        }
      }
      await mkdir(directory, { recursive: true });
      for (const [index, frame] of frames.entries()) {
        await copyFile(join(scratch, `${index}.png`), frame.path, constants.COPYFILE_EXCL);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return { ...info, decodeValid: true, frames, elapsedSeconds: elapsedSince(start) };
}

function options(args, allowed) {
  const values = {};
  const positional = [];
  for (const arg of args) {
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const match = /^--([^=]+)=(.*)$/.exec(arg);
      if (!match || !allowed.includes(match[1]) || values[match[1]] !== undefined) throw new Error(`Unknown or duplicate option: ${arg}`);
      values[match[1]] = match[2];
    }
  }
  return { positional, values };
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h') { process.stdout.write(usage); return; }
  let result;
  if (command === 'convert') {
    const { positional } = options(rest, []);
    if (positional.length !== 2) throw new Error(usage);
    result = await convertMedia(...positional);
  } else if (command === 'slideshow') {
    const { positional, values } = options(rest, ['seconds']);
    if (positional.length < 2) throw new Error(usage);
    result = await createSlideshow(positional[0], positional.slice(1), { seconds: values.seconds });
  } else if (command === 'inspect') {
    const { positional, values } = options(rest, ['at', 'frames-dir']);
    if (positional.length !== 1) throw new Error(usage);
    if (values['frames-dir'] === '') throw new Error('--frames-dir must not be empty.');
    result = await inspectMedia(positional[0], { at: values.at?.split(','), framesDir: values['frames-dir'] });
  } else throw new Error(usage);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
