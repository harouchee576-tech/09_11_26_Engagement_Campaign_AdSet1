import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import { STORAGE_DIR } from '../config.ts';
import { getProviderCatalogAsync } from '../providers/modular.ts';
import type { ProviderDescriptor } from '../types.ts';

const execFileAsync = promisify(execFile);

export interface LibraryAvailability {
  id: string;
  name: string;
  category: 'vidéo' | 'audio' | 'ia-locale' | 'runtime' | 'cloud-gratuit';
  available: boolean;
  detail: string;
}

export interface HardwareDiagnostics {
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuUsagePercent: number;
  loadAverage1m: number;
  memoryTotalMb: number;
  memoryFreeMb: number;
  diskFreeGb: number;
  ffmpegVersion: string | null;
  ffprobeAvailable: boolean;
  libraries: LibraryAvailability[];
}

export interface EngineStatus {
  id: 'harou-devin-2.0' | 'harou-ailleurs-4.6' | 'harou-tic-tac-3.7' | 'harou-unix-5.8';
  name: string;
  role: string;
  capabilities: string[];
  operational: boolean;
  activeProviders: string[];
  preferredFreeModel: string;
  dependencies: string[];
}

interface CpuTotals {
  idle: number;
  total: number;
}

let prevCpuTotals: CpuTotals | null = null;

function readCpuTotals(): CpuTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

async function measureCpuPercent(): Promise<number> {
  if (!prevCpuTotals) {
    const start = readCpuTotals();
    await new Promise((r) => setTimeout(r, 120));
    const end = readCpuTotals();
    prevCpuTotals = end;
    const totalDiff = end.total - start.total;
    const idleDiff = end.idle - start.idle;
    if (totalDiff <= 0) return 0;
    return Number(Math.min(100, Math.max(0, ((totalDiff - idleDiff) / totalDiff) * 100)).toFixed(1));
  }

  const current = readCpuTotals();
  const totalDiff = current.total - prevCpuTotals.total;
  const idleDiff = current.idle - prevCpuTotals.idle;
  prevCpuTotals = current;
  if (totalDiff <= 0) return 0;
  return Number(Math.min(100, Math.max(0, ((totalDiff - idleDiff) / totalDiff) * 100)).toFixed(1));
}

async function probeBinary(
  candidates: string[],
  versionArgs: string[] = ['--version']
): Promise<{ path: string | null; version: string | null }> {
  for (const bin of candidates) {
    if (!bin) continue;
    try {
      const { stdout: whichOut } = await execFileAsync('which', [bin]);
      const binPath = whichOut.trim().split('\n')[0]?.trim();
      if (!binPath) continue;
      try {
        const { stdout, stderr } = await execFileAsync(binPath, versionArgs, { timeout: 1500 });
        const line = (stdout || stderr || '').split('\n')[0]?.trim() || binPath;
        return { path: binPath, version: line };
      } catch {
        return { path: binPath, version: binPath };
      }
    } catch {
      // binary not in PATH
    }
  }
  return { path: null, version: null };
}

export async function getRealHardwareDiagnostics(): Promise<HardwareDiagnostics> {
  const cpus = os.cpus();
  const [cpuUsagePercent, ffmpegProbe, ffprobeProbe, piperProbe, espeakProbe, pythonProbe] =
    await Promise.all([
      measureCpuPercent(),
      probeBinary(['ffmpeg'], ['-version']),
      probeBinary(['ffprobe'], ['-version']),
      probeBinary([process.env.PIPER_BIN?.trim() || '', 'piper'], ['--help']),
      probeBinary([process.env.ESPEAK_BIN?.trim() || '', 'espeak-ng', 'espeak'], ['--version']),
      probeBinary(['python3', 'python'], ['--version']),
    ]);

  let diskFreeGb = 0;
  try {
    const statfs = fs.statfsSync(STORAGE_DIR);
    diskFreeGb = Number(((statfs.bavail * statfs.bsize) / (1024 * 1024 * 1024)).toFixed(2));
  } catch {
    diskFreeGb = 0;
  }

  const piperModelPath = process.env.PIPER_MODEL?.trim();
  const piperModelExists = Boolean(piperModelPath && fs.existsSync(piperModelPath));

  const libraries: LibraryAvailability[] = [
    {
      id: 'ffmpeg',
      name: 'FFmpeg (Encodage H.264 / AAC / Filtres)',
      category: 'vidéo',
      available: Boolean(ffmpegProbe.path),
      detail: ffmpegProbe.version || 'Binaire ffmpeg introuvable dans PATH',
    },
    {
      id: 'ffprobe',
      name: 'FFprobe (Inspection flux média)',
      category: 'vidéo',
      available: Boolean(ffprobeProbe.path),
      detail: ffprobeProbe.version || 'Binaire ffprobe introuvable dans PATH',
    },
    {
      id: 'piper',
      name: 'Piper TTS (Synthèse neuronale locale)',
      category: 'audio',
      available: Boolean(piperProbe.path) && piperModelExists,
      detail: piperProbe.path
        ? piperModelExists
          ? `Binaire ${piperProbe.path} + modèle configuré`
          : `Binaire ${piperProbe.path} détecté (PIPER_MODEL manquant)`
        : 'Non installé (repli automatique vers Gemini TTS / TTS gratuit)',
    },
    {
      id: 'espeak',
      name: 'eSpeak-NG (Synthèse vocale locale)',
      category: 'audio',
      available: Boolean(espeakProbe.path),
      detail: espeakProbe.version || 'Non installé sur le conteneur',
    },
    {
      id: 'python3',
      name: 'Python 3 Runtime',
      category: 'runtime',
      available: Boolean(pythonProbe.path),
      detail: pythonProbe.version || 'Python non détecté',
    },
  ];

  return {
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model?.trim() || 'CPU',
    cpuCores: cpus.length,
    cpuUsagePercent,
    loadAverage1m: Number(os.loadavg()[0]?.toFixed(2) || 0),
    memoryTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
    memoryFreeMb: Math.round(os.freemem() / (1024 * 1024)),
    diskFreeGb,
    ffmpegVersion: ffmpegProbe.version,
    ffprobeAvailable: Boolean(ffprobeProbe.path),
    libraries,
  };
}

export async function getUnifiedEnginesReport(): Promise<{
  system: 'HAROU GENERATOR 2.0';
  timestamp: string;
  hardware: HardwareDiagnostics;
  engines: EngineStatus[];
  providers: ProviderDescriptor[];
}> {
  const [hardware, providers] = await Promise.all([
    getRealHardwareDiagnostics(),
    getProviderCatalogAsync(),
  ]);

  const localServiceLibs: LibraryAvailability[] = providers
    .filter((p) =>
      ['ollama-local', 'comfyui-local', 'sd-webui-local', 'gemini-free', 'pollinations-text', 'pollinations-flux'].includes(
        p.id
      )
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.license === 'free-tier' || p.id.startsWith('pollinations') ? 'cloud-gratuit' : 'ia-locale',
      available: p.available,
      detail: p.reason,
    }));

  hardware.libraries = [...hardware.libraries, ...localServiceLibs];

  const activeByCap = (cap: ProviderDescriptor['capability']) =>
    providers.filter((p) => p.capability === cap && p.available);

  const scenarioActive = activeByCap('scenario');
  const imageActive = activeByCap('image');
  const audioActive = activeByCap('audio');
  const videoActive = activeByCap('video');
  const assemblyActive = activeByCap('assembly');

  const engines: EngineStatus[] = [
    {
      id: 'harou-devin-2.0',
      name: 'HAROU DEVIN 2.0',
      role: 'Intelligence créative, structuration narrative et scénarios',
      capabilities: ['scenario', 'script-breakdown', 'camera-direction'],
      operational: scenarioActive.length > 0,
      activeProviders: scenarioActive.map((p) => p.id),
      preferredFreeModel: scenarioActive.find((p) => p.isDefault)?.id || scenarioActive[0]?.id || 'aucun',
      dependencies: ['Ollama (optionnel)', 'Gemini Free Tier (optionnel)', 'Pollinations Open LLM'],
    },
    {
      id: 'harou-ailleurs-4.6',
      name: 'HAROU AILLEURS 4.6',
      role: 'Génération visuelle, direction artistique et création d’images',
      capabilities: ['image', 'character-portrait', 'keyframe-art'],
      operational: imageActive.length > 0,
      activeProviders: imageActive.map((p) => p.id),
      preferredFreeModel: imageActive.find((p) => p.isDefault)?.id || imageActive[0]?.id || 'aucun',
      dependencies: ['ComfyUI / SD Forge (optionnel)', 'Pollinations FLUX / Turbo'],
    },
    {
      id: 'harou-tic-tac-3.7',
      name: 'HAROU TIC-TAC 3.7',
      role: 'Mémoire partagée, cohérence des personnages, voix et coordination',
      capabilities: ['memory', 'character-consistency', 'audio-dialogue', 'coordination'],
      operational: audioActive.length > 0,
      activeProviders: audioActive.map((p) => p.id),
      preferredFreeModel: audioActive.find((p) => p.isDefault)?.id || audioActive[0]?.id || 'aucun',
      dependencies: ['Store persistant JSON', 'Piper / eSpeak-NG (optionnel)', 'Gemini TTS / TTS gratuit'],
    },
    {
      id: 'harou-unix-5.8',
      name: 'HAROU UNIX 5.8',
      role: 'Génération de séquences vidéo, montage multi-scènes et export MP4',
      capabilities: ['video-sequence', 'scene-assembly', 'mp4-mastering'],
      operational: Boolean(hardware.ffmpegVersion) && videoActive.length > 0 && assemblyActive.length > 0,
      activeProviders: [...videoActive, ...assemblyActive].map((p) => p.id),
      preferredFreeModel: 'ffmpeg-motion + ffmpeg-composer',
      dependencies: [
        hardware.ffmpegVersion ? 'FFmpeg installé' : 'FFmpeg manquant',
        hardware.ffprobeAvailable ? 'FFprobe actif' : 'FFprobe manquant',
      ],
    },
  ];

  return {
    system: 'HAROU GENERATOR 2.0',
    timestamp: new Date().toISOString(),
    hardware,
    engines,
    providers,
  };
}
