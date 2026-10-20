import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function narrationSummary(prepared) {
  return { status: prepared.status, voice: prepared.voice ?? null, reason: prepared.reason ?? null };
}

export function unavailableNarration(reason) {
  process.stderr.write(`Narration unavailable; exporting silent audio: ${reason}\n`);
  return { status: 'unavailable', reason, clips: [] };
}

/** Synthesize a batch before opening the recording page; never plays through speakers. */
export async function prepareNarration(texts, {
  dir, narration = 'auto', voice = 'Microsoft Irina Desktop',
} = {}) {
  if (!['auto', 'off'].includes(narration)) throw new Error('narration must be auto or off.');
  if (narration === 'off') return { status: 'off', clips: [] };
  if (process.platform !== 'win32') {
    return { status: 'unsupported', reason: 'Local narration is Windows-only.', clips: [] };
  }
  if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string' || !text.trim())) {
    throw new Error('Narration phrases must be non-empty strings.');
  }
  if (!dir) throw new Error('Narration requires an artifact directory.');
  const directory = resolve(dir);
  await mkdir(directory, { recursive: true });
  const request = join(directory, 'speech-request.json');
  const reportPath = join(directory, 'speech-report.json');
  const manifestPath = join(directory, 'narration.json');
  await writeFile(request, JSON.stringify({ voice, texts: [...new Set(texts)] }), { flag: 'wx' });
  let prepared;
  try {
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      fileURLToPath(new URL('./speech.ps1', import.meta.url)), '-InputPath', request, '-OutputPath', reportPath],
    { windowsHide: true, timeout: 120000 });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (report.status === 'unavailable') throw new Error(report.reason);
    const clips = [];
    for (const clip of report.clips) {
      const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', clip.path], { windowsHide: true });
      const duration = Number(JSON.parse(stdout).format.duration);
      if (!(duration > 0)) throw new Error('Speech synthesis produced an empty audio file.');
      clips.push({ ...clip, duration });
    }
    prepared = { status: 'ready', voice: report.voice, clips };
  } catch (error) {
    prepared = unavailableNarration(error.message);
  }
  prepared.manifestPath = manifestPath;
  await writeFile(manifestPath, JSON.stringify(prepared, null, 2), { flag: 'wx' });
  return prepared;
}

/** Load prepared assets only. Export never synthesizes or calls a cloud service. */
export async function loadNarration(value) {
  if (value === undefined || value === 'off') return { status: 'off', clips: [] };
  const prepared = typeof value === 'string' ? JSON.parse(await readFile(value, 'utf8')) : value;
  if (!prepared || !['ready', 'off', 'unsupported', 'unavailable'].includes(prepared.status)
    || !Array.isArray(prepared.clips)) throw new Error('Invalid prepared narration manifest.');
  if (prepared.status === 'ready' && prepared.clips.some(clip =>
    typeof clip.text !== 'string' || typeof clip.path !== 'string' || !(clip.duration > 0))) {
    throw new Error('Narration clips require text, path, and positive duration.');
  }
  return prepared;
}

export function narrationClip(prepared, text) {
  return prepared.status === 'ready' ? prepared.clips.find(clip => clip.text === text) : undefined;
}

/** Wait only for speech that extends beyond the action and requested final-state hold. */
export function narrationHoldMs(holdMs, clip, elapsedMs) {
  return Math.max(holdMs, clip ? clip.duration * 1000 + 200 - elapsedMs : 0);
}
