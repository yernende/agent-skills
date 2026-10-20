#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNarration, narrationClip, narrationSummary, unavailableNarration } from './narration.mjs';

const usage = `Usage:
  node media.mjs convert INPUT OUTPUT.mp4 [--captions=TRACK.json] [--narration=PREPARED.json|off] [--mode=quick|strict]
  node media.mjs slideshow OUTPUT.mp4 FRAME... [--seconds=3] [--slides=SLIDES.json] [--narration=PREPARED.json|off] [--mode=quick|strict]
  node media.mjs inspect INPUT [--mode=quick|strict] [--at=0,1.2,3] [--frames-dir=ABS_DIR]

Quick defaults to metadata/sample frames; strict also decodes the complete file.
Caption tracks: [{start,end,text}], seconds relative to the raw video's start.
Requires ffmpeg (libass) and ffprobe. Existing outputs are never overwritten.
Slideshow inputs must be equal-sized still PNG/JPEG/WebP/BMP images.
--at requires --frames-dir. With only --frames-dir, extracts start/middle/end.
`;

function run(binary, args, { cwd } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', error => reject(new Error(`${binary}: ${error.message}`, { cause: error })));
    child.on('close', code => code === 0 ? resolveResult(stdout)
      : reject(new Error(`${binary} exited with code ${code}: ${stderr.trim()}`)));
  });
}

function finiteNumber(value, name, allowZero = false) {
  const result = Number(value);
  if (String(value).trim() === '' || !Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) {
    throw new Error(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return result;
}

function modeOption(mode = 'quick') {
  if (!['quick', 'strict'].includes(mode)) throw new Error('mode must be quick or strict.');
  return mode;
}

async function inputFile(path) {
  const absolutePath = resolve(path);
  if (!(await stat(absolutePath)).isFile()) throw new Error(`Input is not a file: ${absolutePath}`);
  return absolutePath;
}

async function refuseExisting(path) {
  try { await access(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Refusing to overwrite existing output: ${path}`);
}

async function probe(path) {
  const data = JSON.parse(await run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
    'format=duration,format_name:format_tags=comment,major_brand:stream=codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,width,height,duration,avg_frame_rate,sample_rate,channels,channel_layout:stream_disposition=default',
    '-of', 'json', path,
  ]));
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  if (!video || !(video.width > 0 && video.height > 0)) throw new Error(`No video/image stream in ${path}`);
  return { format: data.format ?? {}, video, audio: data.streams.find(stream => stream.codec_type === 'audio') };
}

async function decode(path) {
  await run('ffmpeg', [
    '-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-err_detect', 'explode',
    '-protocol_whitelist', 'file,pipe', '-i', path, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-',
  ]);
}

function videoInfo(path, { format, video, audio }, bytes) {
  const [numerator, denominator] = String(video.avg_frame_rate).split('/').map(Number);
  return {
    path, kind: format.tags?.comment === 'browser-video-qa:slideshow' ? 'slideshow' : 'video',
    duration: finiteNumber(format.duration ?? video.duration, 'Media duration'),
    videoDuration: Number(video.duration ?? format.duration),
    width: video.width, height: video.height, bytes, codec: video.codec_name,
    profile: video.profile, level: video.level, pixelFormat: video.pix_fmt,
    fps: denominator > 0 ? numerator / denominator : null,
    videoTag: video.codec_tag_string, videoDefault: video.disposition?.default === 1,
    brand: format.tags?.major_brand,
    audio: audio ? {
      codec: audio.codec_name, profile: audio.profile, sampleRate: Number(audio.sample_rate),
      channels: audio.channels, layout: audio.channel_layout,
      default: audio.disposition?.default === 1, duration: Number(audio.duration),
    } : null,
  };
}

async function inspectVideo(path, mode) {
  const data = await probe(path);
  const info = videoInfo(path, data, (await stat(path)).size);
  if (mode === 'strict') await decode(path);
  return { info };
}

const elapsedSince = start => Number(((performance.now() - start) / 1000).toFixed(3));
const validation = (mode, sampled = false) => ({
  mode, verification: mode === 'strict' ? 'full' : sampled ? 'sampled' : 'metadata',
  decodeValid: mode === 'strict' ? true : null,
});
const evenPad = 'pad=ceil(iw/2)*2:ceil(ih/2)*2';
const fit = "scale=w='min(iw,1920)':h='min(ih,1080)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
const encoding = [
  '-map_metadata', '-1', '-map_chapters', '-1',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-profile:v', 'main', '-level:v', '4.0',
  '-pix_fmt', 'yuv420p', '-r', '25', '-fps_mode', 'cfr', '-g', '50', '-keyint_min', '25',
  '-sc_threshold', '0', '-tag:v', 'avc1',
  '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ar', '44100', '-ac', '2',
  '-disposition:v:0', 'default', '-disposition:a:0', 'default',
  '-brand', 'mp42', '-movflags', '+faststart', '-shortest',
];
const silentInput = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];

async function narrationInput(prepared, cues, duration, scratch) {
  let speech = prepared;
  if (speech.status !== 'ready') return { args: silentInput, summary: narrationSummary(speech) };
  const scheduled = [];
  for (const cue of cues ?? []) {
    const clip = narrationClip(speech, cue.text);
    if (!clip || cue.start + clip.duration > Math.min(cue.end, duration) + 0.01) {
      speech = unavailableNarration('A phrase is missing or does not fit its caption interval. Record with the prepared narration to allow enough hold time.');
      return { args: silentInput, summary: narrationSummary(speech) };
    }
    scheduled.push({ ...clip, start: cue.start });
  }
  if (!scheduled.length) {
    speech = unavailableNarration('Narration requires timed phrases.');
    return { args: silentInput, summary: narrationSummary(speech) };
  }
  try {
    const inputs = [];
    const filters = [];
    for (const [index, clip] of scheduled.entries()) {
      inputs.push('-i', await inputFile(clip.path));
      filters.push(`[${index}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(clip.start * 1000)}:all=1[s${index}]`);
    }
    filters.push(`${scheduled.map((_, index) => `[s${index}]`).join('')}amix=inputs=${scheduled.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${duration}[speech]`);
    const wave = join(scratch, 'narration.wav');
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', ...inputs,
      '-filter_complex', filters.join(';'), '-map', '[speech]', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', wave]);
    return { args: ['-i', wave], summary: narrationSummary(speech) };
  } catch (error) {
    speech = unavailableNarration(error.message);
    return { args: silentInput, summary: narrationSummary(speech) };
  }
}

async function createOutput(output, mode, encode) {
  const absoluteOutput = resolve(output);
  if (!absoluteOutput.toLowerCase().endsWith('.mp4')) throw new Error('Output must have an .mp4 extension.');
  await refuseExisting(absoluteOutput);
  const scratch = await mkdtemp(join(tmpdir(), 'browser-video-qa-media-'));
  try {
    const temporaryOutput = join(scratch, 'output.mp4');
    await encode(temporaryOutput, scratch);
    const { info } = await inspectVideo(temporaryOutput, mode);
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await copyFile(temporaryOutput, absoluteOutput, constants.COPYFILE_EXCL);
    return { ...info, path: absoluteOutput, ...validation(mode) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

async function captionTrack(value) {
  const track = typeof value === 'string' ? JSON.parse(await readFile(value, 'utf8')) : value;
  if (!Array.isArray(track)) throw new Error('Captions must be an array of {start,end,text}.');
  let previousEnd = 0;
  return track.map(cue => {
    const start = finiteNumber(cue.start, 'Caption start', true);
    const end = finiteNumber(cue.end, 'Caption end');
    if (end <= start || start < previousEnd || typeof cue.text !== 'string') {
      throw new Error('Captions must have ordered, non-overlapping intervals and plain text.');
    }
    previousEnd = end;
    return { start, end, text: cue.text };
  });
}

function assTime(seconds) {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}

async function captionFilter(video, track, scratch) {
  const width = Math.ceil(video.width / 2) * 2;
  const height = Math.ceil(video.height / 2) * 2;
  const font = Math.max(16, Math.round(width / 60));
  const band = Math.max(96, font * 4);
  const escape = text => text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
  const lines = track.map(cue => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,{\\clip(0,${height},${width},${height + band})}${escape(cue.text)}`);
  await writeFile(join(scratch, 'captions.ass'), `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height + band}
WrapStyle: 0
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,${font},&H00FFFFFF,&H00FFFFFF,&H00181818,&H00181818,0,0,0,0,100,100,0,0,1,0,0,2,24,24,${Math.round((band - font * 2.7) / 2)},1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${lines.join('\n')}
`, 'utf8');
  // Relative generated filenames avoid Windows drive letters/filter escaping.
  return `${evenPad},pad=iw:ih+${band}:0:0:color=0x181818,ass=filename=captions.ass`;
}

/** Add a caption below a screenshot without changing the application's viewport. */
export async function captionScreenshot(buffer, output, text) {
  const destination = resolve(output);
  await refuseExisting(destination);
  const scratch = await mkdtemp(join(tmpdir(), 'browser-video-qa-still-'));
  try {
    const source = join(scratch, 'source.png');
    const result = join(scratch, 'result.png');
    await writeFile(source, buffer);
    const { video } = await probe(source);
    const filter = await captionFilter(video, [{ start: 0, end: 1, text }], scratch);
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n',
      '-i', source, '-vf', `${filter},${fit}`, '-frames:v', '1', result], { cwd: scratch });
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(result, destination, constants.COPYFILE_EXCL);
    return destination;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Encode once, with an optional external caption band and prepared or silent AAC audio. */
export async function convertMedia(input, output, { mode = 'quick', captions, narration } = {}) {
  const start = performance.now();
  mode = modeOption(mode);
  const source = await inputFile(input);
  const sourceData = await probe(source);
  const kind = sourceData.format.tags?.comment === 'browser-video-qa:slideshow' ? 'slideshow' : 'video';
  const track = captions === undefined ? undefined : await captionTrack(captions);
  const speech = await loadNarration(narration);
  const speechCues = speech.cues === undefined ? track : await captionTrack(speech.cues);
  let speechSummary;
  const result = await createOutput(output, mode, async (temporaryOutput, scratch) => {
    const filter = track === undefined ? evenPad : await captionFilter(sourceData.video, track, scratch);
    const duration = Number(sourceData.video.duration ?? sourceData.format.duration);
    const audio = await narrationInput(speech, speechCues, duration, scratch);
    speechSummary = audio.summary;
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-err_detect', 'explode',
      '-protocol_whitelist', 'file,pipe', '-i', source, ...audio.args,
      '-map', '0:v:0', '-map', '1:a:0', '-t', String(sourceData.video.duration ?? sourceData.format.duration),
      '-vf', `${filter},${fit}`, ...encoding,
      '-metadata', `comment=browser-video-qa:${kind}`, temporaryOutput,
    ], { cwd: scratch });
  });
  return { ...result, narration: speechSummary, elapsedSeconds: elapsedSince(start) };
}

/** Assemble captioned stills; this does not demonstrate continuous motion. */
export async function createSlideshow(output, frames, { seconds = 3, mode = 'quick', narration } = {}) {
  const start = performance.now();
  mode = modeOption(mode);
  const frameSeconds = finiteNumber(seconds, 'seconds');
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('At least one slideshow frame is required.');
  const speech = await loadNarration(narration);
  const cues = [];
  let duration = 0;
  const sources = [];
  let dimensions;
  for (const frame of frames) {
    const slide = typeof frame === 'string' ? { path: frame } : frame;
    const source = await inputFile(slide.path);
    const { video, format } = await probe(source);
    if (!['png', 'mjpeg', 'webp', 'bmp'].includes(video.codec_name)
      || !['image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe'].includes(format.format_name)) {
      throw new Error(`Slideshow frame must be a still PNG/JPEG/WebP/BMP image: ${source}`);
    }
    const size = `${video.width}x${video.height}`;
    if (dimensions && dimensions !== size) throw new Error(`Slideshow frames must have equal dimensions (${dimensions} vs ${size}).`);
    dimensions = size;
    const clip = narrationClip(speech, slide.text);
    const seconds = Math.max(finiteNumber(slide.seconds ?? frameSeconds, 'Slide duration'), clip ? clip.duration + 0.2 : 0);
    cues.push({ start: duration, end: duration + seconds, text: slide.text ?? '' });
    duration += seconds;
    sources.push({ path: source, codec: video.codec_name, seconds });
  }
  let speechSummary;
  const result = await createOutput(output, mode, async (temporaryOutput, scratch) => {
    const entries = [];
    for (const [index, source] of sources.entries()) {
      const name = `frame-${index}.png`;
      if (source.codec === 'png') await copyFile(source.path, join(scratch, name));
      else await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror',
        '-i', source.path, '-frames:v', '1', join(scratch, name)]);
      entries.push(`file '${name}'`, `duration ${source.seconds}`);
    }
    entries.push(`file 'frame-${sources.length - 1}.png'`);
    const manifest = join(scratch, 'frames.txt');
    await writeFile(manifest, `${entries.join('\n')}\n`);
    const audio = await narrationInput(speech, cues, duration, scratch);
    speechSummary = audio.summary;
    await run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-f', 'concat', '-safe', '0',
      '-protocol_whitelist', 'file,pipe', '-i', manifest, ...audio.args,
      '-map', '0:v:0', '-map', '1:a:0', '-t', String(duration),
      '-vf', `fps=25,${evenPad},${fit}`, ...encoding,
      '-metadata', 'comment=browser-video-qa:slideshow', temporaryOutput,
    ]);
  });
  return { ...result, narration: speechSummary, elapsedSeconds: elapsedSince(start) };
}

/** Read metadata/sample frames; strict requests one complete decode. */
export async function inspectMedia(input, { mode = 'quick', at, framesDir } = {}) {
  const start = performance.now();
  mode = modeOption(mode);
  if (at !== undefined && !framesDir) throw new Error('--at requires --frames-dir.');
  if (at !== undefined && (!Array.isArray(at) || at.length === 0)) throw new Error('at must contain at least one frame time.');
  const requestedTimes = at?.map(time => finiteNumber(time, 'Frame time', true));
  const source = await inputFile(input);
  const { info } = await inspectVideo(source, mode);
  const frames = [];
  if (framesDir) {
    const directory = resolve(framesDir);
    const videoEnd = Math.min(info.duration, info.videoDuration);
    const endTime = Math.max(0, videoEnd - Math.max(info.fps > 0 ? 1 / info.fps : 0, 0.1));
    const times = requestedTimes ?? [0, videoEnd / 2, endTime];
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
          '-ss', String(frame.time), '-i', source, '-frames:v', '1', temporaryFrame,
        ]);
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
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  return { ...info, ...validation(mode, frames.length > 0), frames, elapsedSeconds: elapsedSince(start) };
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
    const { positional, values } = options(rest, ['mode', 'captions', 'narration']);
    if (positional.length !== 2) throw new Error(usage);
    result = await convertMedia(...positional, { mode: values.mode, captions: values.captions, narration: values.narration });
  } else if (command === 'slideshow') {
    const { positional, values } = options(rest, ['seconds', 'mode', 'narration', 'slides']);
    if (values.slides ? positional.length !== 1 : positional.length < 2) throw new Error(usage);
    const slides = values.slides ? JSON.parse(await readFile(values.slides, 'utf8')) : positional.slice(1);
    result = await createSlideshow(positional[0], slides, { seconds: values.seconds, mode: values.mode, narration: values.narration });
  } else if (command === 'inspect') {
    const { positional, values } = options(rest, ['at', 'frames-dir', 'mode']);
    if (positional.length !== 1) throw new Error(usage);
    if (values['frames-dir'] === '') throw new Error('--frames-dir must not be empty.');
    result = await inspectMedia(positional[0], { mode: values.mode, at: values.at?.split(','), framesDir: values['frames-dir'] });
  } else throw new Error(usage);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
