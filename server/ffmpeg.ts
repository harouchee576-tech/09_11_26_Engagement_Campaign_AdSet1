import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { ExportProfile, MotionPreset, TransitionPreset } from './types.ts';

const execFileAsync = promisify(execFile);

export interface MediaProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  codec?: string;
  sizeBytes: number;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const stat = await fs.promises.stat(filePath);
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
  };
  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  const rawDuration =
    parsed.format?.duration ?? videoStream?.duration ?? audioStream?.duration ?? '0';
  const durationSec = Math.max(0, Number.parseFloat(rawDuration) || 0);

  return {
    durationSec: Number(durationSec.toFixed(2)),
    width: videoStream?.width,
    height: videoStream?.height,
    codec: videoStream?.codec_name ?? audioStream?.codec_name,
    sizeBytes: stat.size,
  };
}

function parseFfmpegTimeToSeconds(line: string): number | null {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  return h * 3600 + m * 60 + s;
}

function runFfmpeg(
  args: string[],
  expectedDurationSec: number,
  onProgress?: (pct: number) => void,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let lastLogAt = 0;

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrTail = (stderrTail + text).slice(-4000);

      if (onLog) {
        const lines = text
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const isFrameLine = line.startsWith('frame=') || line.startsWith('size=');
          const isImportant =
            line.startsWith('Output #0') ||
            line.startsWith('Stream mapping:') ||
            line.includes('kb/s:') ||
            line.includes('Lsize=');
          const now = Date.now();
          if (isImportant || (isFrameLine && now - lastLogAt >= 1200)) {
            lastLogAt = now;
            onLog(line.slice(0, 180));
          }
        }
      }

      if (onProgress && expectedDurationSec > 0) {
        const currentSec = parseFfmpegTimeToSeconds(text);
        if (currentSec !== null) {
          const pct = Math.min(99, Math.max(1, Math.round((currentSec / expectedDurationSec) * 100)));
          onProgress(pct);
        }
      }
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrTail.trim().slice(-500)}`));
      }
    });
  });
}

export async function renderSequenceFromImage(options: {
  imagePath: string;
  audioPath?: string;
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  motion: MotionPreset;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
}): Promise<MediaProbeResult> {
  const width = options.width % 2 === 0 ? options.width : options.width + 1;
  const height = options.height % 2 === 0 ? options.height : options.height + 1;
  const fps = Math.max(12, Math.min(60, options.fps || 24));

  let targetDuration = Math.max(2, options.durationSec || 5);
  if (options.audioPath) {
    const audioProbe = await probeMedia(options.audioPath);
    if (audioProbe.durationSec > 0) {
      targetDuration = Math.max(targetDuration, Number((audioProbe.durationSec + 0.4).toFixed(2)));
    }
  }

  const totalFrames = Math.max(fps * 2, Math.round(targetDuration * fps));
  const upW = width * 2;
  const upH = height * 2;

  let motionFilter: string;
  switch (options.motion) {
    case 'ken_burns_in':
      motionFilter = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'ken_burns_out':
      motionFilter = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='if(lte(zoom,1.0),1.18,max(1.001,zoom-0.0012))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_left':
      motionFilter = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='1.14':x='(iw-iw/zoom)*(1-on/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_right':
      motionFilter = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='1.14':x='(iw-iw/zoom)*(on/${totalFrames})':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'tilt_up':
      motionFilter = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='1.14':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${totalFrames})':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'static_hold':
    default:
      motionFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps}`;
      break;
  }

  const vf = `${motionFilter},setsar=1,format=yuv420p`;

  const args: string[] = ['-y', '-loop', '1', '-i', options.imagePath];
  if (options.audioPath) {
    args.push('-i', options.audioPath);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  args.push(
    '-filter_complex',
    `[0:v]${vf}[vout];[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${targetDuration}[aout]`,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    String(targetDuration),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    options.outputPath
  );

  await runFfmpeg(args, targetDuration, options.onProgress, options.onLog);
  return probeMedia(options.outputPath);
}

export async function assembleScenes(options: {
  sequencePaths: string[];
  outputPath: string;
  transition: TransitionPreset;
  transitionDurationSec: number;
  width: number;
  height: number;
  fps: number;
  musicAudioPath?: string;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
}): Promise<MediaProbeResult> {
  if (options.sequencePaths.length === 0) {
    throw new Error('Au moins une séquence vidéo est requise pour l’assemblage.');
  }

  const width = options.width % 2 === 0 ? options.width : options.width + 1;
  const height = options.height % 2 === 0 ? options.height : options.height + 1;
  const fps = Math.max(12, Math.min(60, options.fps || 24));
  const probes = await Promise.all(options.sequencePaths.map((p) => probeMedia(p)));
  const totalRawDuration = probes.reduce((acc, p) => acc + Math.max(1, p.durationSec), 0);

  if (options.sequencePaths.length === 1 && !options.musicAudioPath) {
    const args = [
      '-y',
      '-i',
      options.sequencePaths[0],
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      options.outputPath,
    ];
    await runFfmpeg(args, totalRawDuration, options.onProgress, options.onLog);
    return probeMedia(options.outputPath);
  }

  const args: string[] = ['-y'];
  for (const seqPath of options.sequencePaths) {
    args.push('-i', seqPath);
  }
  if (options.musicAudioPath) {
    args.push('-stream_loop', '-1', '-i', options.musicAudioPath);
  }

  const filterParts: string[] = [];
  for (let i = 0; i < options.sequencePaths.length; i++) {
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`
    );
    filterParts.push(
      `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`
    );
  }

  const minClipDuration = Math.min(...probes.map((p) => p.durationSec || 2));
  const td = Math.min(options.transitionDurationSec || 0.6, Math.max(0.2, minClipDuration * 0.35));

  if (options.sequencePaths.length === 1) {
    filterParts.push(`[v0]copy[vout]`);
    filterParts.push(`[a0]acopy[a_base]`);
  } else if (options.transition === 'cut') {
    const inputs = probes.map((_, i) => `[v${i}][a${i}]`).join('');
    filterParts.push(`${inputs}concat=n=${probes.length}:v=1:a=1[vout][a_base]`);
  } else {
    let prevV = 'v0';
    let prevA = 'a0';
    let runningDuration = Math.max(1, probes[0].durationSec);

    for (let i = 1; i < probes.length; i++) {
      const offset = Number(Math.max(0.1, runningDuration - td).toFixed(2));
      const outV = i === probes.length - 1 ? 'vout' : `vx${i}`;
      const outA = i === probes.length - 1 ? 'a_base' : `ax${i}`;
      filterParts.push(
        `[${prevV}][v${i}]xfade=transition=${options.transition}:duration=${td}:offset=${offset}[${outV}]`
      );
      filterParts.push(`[${prevA}][a${i}]acrossfade=d=${td}[${outA}]`);
      prevV = outV;
      prevA = outA;
      runningDuration = offset + Math.max(1, probes[i].durationSec);
    }
  }

  if (options.musicAudioPath) {
    const musicIndex = options.sequencePaths.length;
    filterParts.push(`[${musicIndex}:a]aresample=44100,volume=0.16[bgm]`);
    filterParts.push(`[a_base][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
  } else {
    filterParts.push(`[a_base]acopy[aout]`);
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    options.outputPath
  );

  await runFfmpeg(args, totalRawDuration, options.onProgress, options.onLog);
  return probeMedia(options.outputPath);
}

export async function exportMasterMp4(options: {
  inputPath: string;
  outputPath: string;
  profile: ExportProfile;
  title?: string;
  onProgress?: (pct: number) => void;
  onLog?: (line: string) => void;
}): Promise<MediaProbeResult> {
  const probe = await probeMedia(options.inputPath);

  const profileMap: Record<ExportProfile, { width: number; height: number; bitrate: string }> = {
    '1080p': { width: 1920, height: 1080, bitrate: '4500k' },
    '720p': { width: 1280, height: 720, bitrate: '2500k' },
    vertical_9_16: { width: 1080, height: 1920, bitrate: '3500k' },
    square_1_1: { width: 1080, height: 1080, bitrate: '3000k' },
  };

  const target = profileMap[options.profile] ?? profileMap['720p'];
  const args = [
    '-y',
    '-i',
    options.inputPath,
    '-vf',
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-b:v',
    target.bitrate,
    '-maxrate',
    target.bitrate,
    '-bufsize',
    '6000k',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-metadata',
    `title=${options.title || 'HAROU GENERATOR Master'}`,
    '-metadata',
    'encoder=HAROU GENERATOR FFmpeg Pipeline',
    '-movflags',
    '+faststart',
    options.outputPath,
  ];

  await runFfmpeg(args, Math.max(1, probe.durationSec), options.onProgress, options.onLog);
  return probeMedia(options.outputPath);
}

export async function concatAudioFilesToWav(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error('Aucun segment audio à assembler.');
  }
  if (inputPaths.length === 1) {
    await runFfmpeg(
      ['-y', '-i', inputPaths[0], '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath],
      1
    );
    return;
  }
  const args: string[] = ['-y'];
  const filters: string[] = [];
  for (let i = 0; i < inputPaths.length; i++) {
    args.push('-i', inputPaths[i]);
    filters.push(`[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`);
  }
  const concatInputs = inputPaths.map((_, i) => `[a${i}]`).join('');
  filters.push(`${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[aout]', '-c:a', 'pcm_s16le', outputPath);
  await runFfmpeg(args, inputPaths.length);
}

