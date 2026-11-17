import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_PATHS } from '../config.ts';
import { HarouTicTacMemory } from '../engines/harou2.ts';
import { eventBus } from '../events.ts';
import {
  assembleScenes,
  exportMasterMp4,
  probeMedia,
  renderSequenceFromImage,
} from '../ffmpeg.ts';
import {
  isValidMotionPreset,
  runAudioProvider,
  runCharacterProvider,
  runImageProvider,
  runScenarioProvider,
} from '../providers/modular.ts';
import { db } from '../store.ts';
import type {
  CharacterRecord,
  ExportProfile,
  JobRecord,
  JobType,
  LogEngineTag,
  MediaAssetRecord,
  MotionPreset,
  ProductionProject,
  ScenarioRecord,
  TransitionPreset,
} from '../types.ts';

interface QueuedTask {
  jobId: string;
  run: (ctx: TaskContext) => Promise<Record<string, unknown>>;
}

interface TaskContext {
  jobId: string;
  setProgress: (
    progress: number,
    step: string,
    logMessage?: string,
    engine?: LogEngineTag
  ) => Promise<void>;
  log: (
    level: 'info' | 'warn' | 'error',
    message: string,
    engine?: LogEngineTag
  ) => Promise<void>;
}

const MAX_CONCURRENT = 2;
const queue: QueuedTask[] = [];
const cancelledSet = new Set<string>();
let activeCount = 0;

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function sendWebhook(job: JobRecord): Promise<void> {
  if (!job.webhookUrl) return;
  try {
    await fetch(job.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: job.status === 'completed' ? 'job.completed' : 'job.failed',
        timestamp: new Date().toISOString(),
        job,
      }),
    });
  } catch {
    // Do not fail job state if webhook receiver is unreachable
  }
}

async function processQueue(): Promise<void> {
  if (activeCount >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (!next) return;

  if (cancelledSet.has(next.jobId)) {
    cancelledSet.delete(next.jobId);
    void processQueue();
    return;
  }

  activeCount += 1;

  try {
    const started = await db.updateJob(next.jobId, (j) => {
      j.status = 'processing';
      j.startedAt = new Date().toISOString();
      j.step = 'Initialisation du worker';
      j.progress = Math.max(j.progress, 2);
      j.logs.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        engine: 'orchestrator',
        message: 'Démarrage de la tâche sur HAROU GENERATOR 2.0',
      });
    });
    if (started) eventBus.emitJobUpdate(started);

    const ctx: TaskContext = {
      jobId: next.jobId,
      async setProgress(progress, step, logMessage, engine) {
        const updated = await db.updateJob(next.jobId, (j) => {
          j.progress = Math.min(99, Math.max(0, Math.round(progress)));
          j.step = step;
          if (logMessage) {
            j.logs.push({
              timestamp: new Date().toISOString(),
              level: 'info',
              engine,
              message: logMessage,
            });
            if (j.logs.length > 300) {
              j.logs = j.logs.slice(-300);
            }
          }
        });
        if (updated) eventBus.emitJobUpdate(updated);
      },
      async log(level, message, engine) {
        const updated = await db.updateJob(next.jobId, (j) => {
          j.logs.push({
            timestamp: new Date().toISOString(),
            level,
            engine,
            message,
          });
          if (j.logs.length > 300) {
            j.logs = j.logs.slice(-300);
          }
        });
        if (updated) eventBus.emitJobUpdate(updated);
      },
    };

    const output = await next.run(ctx);
    const completed = await db.updateJob(next.jobId, (j) => {
      j.status = 'completed';
      j.progress = 100;
      j.step = 'Terminé';
      j.output = output;
      j.completedAt = new Date().toISOString();
      j.logs.push({
        timestamp: new Date().toISOString(),
        level: 'info',
        engine: 'orchestrator',
        message: 'Tâche exécutée avec succès.',
      });
    });
    if (completed) {
      eventBus.emitJobUpdate(completed);
      void sendWebhook(completed);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const failed = await db.updateJob(next.jobId, (j) => {
      j.status = 'failed';
      j.step = 'Échec';
      j.error = errorMessage;
      j.completedAt = new Date().toISOString();
      j.logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        engine: 'orchestrator',
        message: errorMessage,
      });
    });
    if (failed) {
      eventBus.emitJobUpdate(failed);
      if (failed.projectId) {
        const proj = await db.updateProject(failed.projectId, (p) => {
          p.status = 'failed';
        });
        if (proj) eventBus.emitProjectUpdate(proj);
      }
      void sendWebhook(failed);
    }
  } finally {
    activeCount -= 1;
    void processQueue();
  }
}

export async function enqueueJob(params: {
  type: JobType;
  provider: string;
  projectId?: string;
  webhookUrl?: string;
  input: Record<string, unknown>;
  run: (ctx: TaskContext) => Promise<Record<string, unknown>>;
}): Promise<{ job: JobRecord; completion: Promise<JobRecord> }> {
  const job: JobRecord = {
    id: makeId('job'),
    type: params.type,
    status: 'queued',
    progress: 0,
    step: 'En file d’attente',
    provider: params.provider,
    projectId: params.projectId,
    webhookUrl: params.webhookUrl,
    input: params.input,
    logs: [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        engine: 'orchestrator',
        message: `Tâche ${params.type} mise en file (${params.provider})`,
      },
    ],
    createdAt: new Date().toISOString(),
  };

  await db.addJob(job);
  eventBus.emitJobUpdate(job);

  const completion = new Promise<JobRecord>((resolve) => {
    const onUpdate = (updated: JobRecord) => {
      if (updated.id === job.id && (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled')) {
        clearInterval(poller);
        resolve(updated);
      }
    };
    const poller = setInterval(() => {
      const current = db.getJob(job.id);
      if (current && (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')) {
        onUpdate(current);
      }
    }, 250);
  });

  queue.push({ jobId: job.id, run: params.run });
  void processQueue();

  return { job, completion };
}

export async function cancelJob(jobId: string): Promise<JobRecord | undefined> {
  const existing = db.getJob(jobId);
  if (!existing) return undefined;
  if (existing.status !== 'queued') {
    return existing;
  }
  cancelledSet.add(jobId);
  const updated = await db.updateJob(jobId, (j) => {
    j.status = 'cancelled';
    j.step = 'Annulé';
    j.completedAt = new Date().toISOString();
    j.logs.push({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Tâche annulée avant exécution.',
    });
  });
  if (updated) eventBus.emitJobUpdate(updated);
  return updated;
}

export async function executeScenarioCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    provider?: string;
    prompt: string;
    genre?: string;
    tone?: string;
    visualStyle?: string;
    sceneCount?: number;
    language?: string;
  }
): Promise<ScenarioRecord> {
  await ctx.setProgress(
    20,
    'HAROU DEVIN 2.0 — Scénarisation',
    `Lecture mémoire TIC-TAC 3.7 (${input.projectId || 'session'}) et rédaction du découpage (${input.sceneCount || 4} scènes)...`,
    'devin'
  );
  const memoryHint = HarouTicTacMemory.buildScenarioContextHint(input.projectId);
  if (memoryHint) {
    await ctx.log('info', `Contexte injecté : ${memoryHint}`, 'tic-tac');
  }
  const enrichedPrompt = memoryHint ? `${input.prompt}\n\n${memoryHint}` : input.prompt;
  const { provider, result } = await runScenarioProvider({
    ...input,
    prompt: enrichedPrompt,
  });

  const totalDurationSec = (result.scenes || []).reduce(
    (sum, sc) => sum + (Number(sc.durationSec) || 6),
    0
  );

  const scenario: ScenarioRecord = {
    id: makeId('scn'),
    projectId: input.projectId,
    title: result.title || 'Scénario sans titre',
    logline: result.logline || input.prompt,
    genre: result.genre || input.genre || 'Cinéma',
    tone: result.tone || input.tone || 'Cinématique',
    visualStyle: result.visualStyle || input.visualStyle || 'Photorealistic 35mm',
    language: input.language || 'fr',
    provider: `harou-devin-2.0/${provider}`,
    totalDurationSec,
    scenes: result.scenes || [],
    createdAt: new Date().toISOString(),
  };

  await db.addScenario(scenario);
  HarouTicTacMemory.registerScenario(input.projectId, scenario);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.scenarioId = scenario.id;
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    90,
    'HAROU DEVIN 2.0 — Scénario prêt',
    `Modèle ${provider} -> "${scenario.title}" (${scenario.scenes.length} scènes, ${totalDurationSec}s) transmis à TIC-TAC 3.7`,
    'devin'
  );
  return scenario;
}

export async function executeImageCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    provider?: string;
    prompt: string;
    width?: number;
    height?: number;
    seed?: number;
  }
): Promise<MediaAssetRecord> {
  const coherentPrompt = HarouTicTacMemory.enrichVisualPrompt(input.prompt, input.projectId);
  if (coherentPrompt !== input.prompt) {
    await ctx.log('info', `Ancres visuelles appliquées au prompt pour HAROU AILLEURS 4.6`, 'tic-tac');
  }
  await ctx.setProgress(
    25,
    'HAROU AILLEURS 4.6 — Création visuelle',
    `Rendu ${input.width || 1280}x${input.height || 720} (${input.provider || 'auto'}) : ${coherentPrompt.slice(0, 85)}...`,
    'ailleurs'
  );
  const id = makeId('img');
  const filename = `${id}.jpg`;
  const outputPath = path.join(STORAGE_PATHS.images, filename);

  const res = await runImageProvider({
    provider: input.provider,
    prompt: coherentPrompt,
    width: input.width,
    height: input.height,
    seed: input.seed,
    outputPath,
  });

  const stat = await fs.promises.stat(outputPath);
  let width = res.width;
  let height = res.height;
  try {
    const probed = await probeMedia(outputPath);
    if (probed.width) width = probed.width;
    if (probed.height) height = probed.height;
  } catch {
    // fallback to requested dimensions
  }

  const asset: MediaAssetRecord = {
    id,
    projectId: input.projectId,
    category: 'images',
    filename,
    mimeType: res.mimeType,
    url: `/api/v1/media/images/${filename}`,
    sizeBytes: stat.size,
    width,
    height,
    prompt: input.prompt,
    provider: `harou-ailleurs-4.6/${res.provider}`,
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.imageAssetIds.push(asset.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    95,
    'HAROU AILLEURS 4.6 — Image prête',
    `Image ${res.provider} enregistrée (${width}x${height}, ${Math.round(stat.size / 1024)} Ko)`,
    'ailleurs'
  );
  return asset;
}

export async function executeCharacterCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    provider?: string;
    imageProvider?: string;
    name?: string;
    concept: string;
    role?: string;
    visualStyle?: string;
    language?: string;
    generatePortrait?: boolean;
  }
): Promise<CharacterRecord> {
  await ctx.setProgress(
    20,
    'HAROU TIC-TAC 3.7 — Profilage personnage',
    `Génération fiche personnage & ancrage identité (${input.name || input.concept.slice(0, 40)})...`,
    'tic-tac'
  );
  const { provider, result } = await runCharacterProvider(input);

  let portraitAssetId: string | undefined;
  let portraitUrl: string | undefined;

  if (input.generatePortrait !== false) {
    await ctx.setProgress(
      55,
      'HAROU AILLEURS 4.6 — Portrait de référence',
      `Délégation du portrait de "${result.name}" vers HAROU AILLEURS 4.6...`,
      'ailleurs'
    );
    const portrait = await executeImageCreation(ctx, {
      projectId: input.projectId,
      provider: input.imageProvider,
      prompt: `${result.visualPromptAnchor}, cinematic character portrait, studio rim lighting, sharp focus`,
      width: 768,
      height: 1024,
    });
    portraitAssetId = portrait.id;
    portraitUrl = portrait.url;
  }

  const character: CharacterRecord = {
    id: makeId('chr'),
    projectId: input.projectId,
    name: result.name,
    role: result.role,
    age: result.age,
    physicalDescription: result.physicalDescription,
    wardrobe: result.wardrobe,
    personality: result.personality,
    voiceStyle: result.voiceStyle,
    recommendedVoice: result.recommendedVoice,
    visualPromptAnchor: result.visualPromptAnchor,
    portraitAssetId,
    portraitUrl,
    provider: `harou-tic-tac-3.7/${provider}`,
    createdAt: new Date().toISOString(),
  };

  await db.addCharacter(character);
  HarouTicTacMemory.registerCharacter(input.projectId, character);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.characterIds.push(character.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    95,
    'HAROU TIC-TAC 3.7 — Personnage indexé',
    `Personnage "${character.name}" (${provider}, voix ${character.recommendedVoice}) mémorisé pour la cohérence inter-scènes.`,
    'tic-tac'
  );
  return character;
}

export async function executeAudioCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    provider?: string;
    text: string;
    voiceName?: string;
    style?: string;
    language?: string;
    mode?: 'single' | 'dialogue';
    speakers?: Array<{ speaker: string; voiceName: string; style?: string; text: string }>;
  }
): Promise<MediaAssetRecord> {
  await ctx.setProgress(
    25,
    'HAROU TIC-TAC 3.7 — Synthèse vocale WAV',
    `Synthèse ${input.mode === 'dialogue' ? 'dialogue 2 locuteurs' : `voix ${input.voiceName || 'Kore'}`} (${input.text.length} car.)...`,
    'tic-tac'
  );
  const id = makeId('aud');
  const filename = `${id}.wav`;
  const outputPath = path.join(STORAGE_PATHS.audio, filename);

  const res = await runAudioProvider({
    provider: input.provider,
    text: input.text,
    voiceName: input.voiceName,
    style: input.style,
    language: input.language,
    mode: input.mode,
    speakers: input.speakers,
    outputPath,
  });

  const probe = await probeMedia(outputPath);

  const asset: MediaAssetRecord = {
    id,
    projectId: input.projectId,
    category: 'audio',
    filename,
    mimeType: res.mimeType,
    url: `/api/v1/media/audio/${filename}`,
    sizeBytes: probe.sizeBytes,
    durationSec: probe.durationSec,
    codec: probe.codec || 'pcm_s16le',
    prompt: input.text.slice(0, 180),
    provider: `harou-tic-tac-3.7/${res.provider}`,
    metadata: {
      voiceName: input.voiceName || 'Kore',
      mode: input.mode || 'single',
    },
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.audioAssetIds.push(asset.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    95,
    'HAROU TIC-TAC 3.7 — Audio synthétisé',
    `Piste WAV (${res.provider}, ${probe.codec || 'pcm_s16le'}, ${probe.durationSec}s) enregistrée.`,
    'tic-tac'
  );
  return asset;
}

export async function executeVideoSequenceCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    imageAssetId?: string;
    prompt?: string;
    audioAssetId?: string;
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    motion?: string;
  }
): Promise<MediaAssetRecord> {
  let imageAsset = input.imageAssetId ? db.getAsset(input.imageAssetId) : undefined;
  if (!imageAsset) {
    if (!input.prompt) {
      throw new Error('Fournissez imageAssetId ou un prompt pour générer la séquence vidéo.');
    }
    await ctx.setProgress(15, 'Image clé manquante', 'Génération préalable de l’image clé open-source...');
    imageAsset = await executeImageCreation(ctx, {
      projectId: input.projectId,
      prompt: input.prompt,
      width: input.width || 1280,
      height: input.height || 720,
    });
  }

  const imagePath = path.join(STORAGE_PATHS.images, imageAsset.filename);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Fichier image introuvable sur le disque : ${imageAsset.filename}`);
  }

  let audioPath: string | undefined;
  if (input.audioAssetId) {
    const audioAsset = db.getAsset(input.audioAssetId);
    if (audioAsset) {
      const candidate = path.join(STORAGE_PATHS.audio, audioAsset.filename);
      if (fs.existsSync(candidate)) {
        audioPath = candidate;
      }
    }
  }

  const id = makeId('seq');
  const filename = `${id}.mp4`;
  const outputPath = path.join(STORAGE_PATHS.sequences, filename);
  const motion: MotionPreset = isValidMotionPreset(input.motion) ? input.motion : 'ken_burns_in';

  await ctx.setProgress(
    35,
    'HAROU UNIX 5.8 — Rendu séquence H.264',
    `FFmpeg libx264 ${input.width || 1280}x${input.height || 720} @ ${input.fps || 24}fps · mouvement ${motion}`,
    'unix'
  );

  const probe = await renderSequenceFromImage({
    imagePath,
    audioPath,
    outputPath,
    durationSec: input.durationSec || 6,
    width: input.width || 1280,
    height: input.height || 720,
    fps: input.fps || 24,
    motion,
    onProgress: (pct) => {
      void ctx.setProgress(35 + Math.round(pct * 0.6), `HAROU UNIX 5.8 — Encodage (${pct}%)`);
    },
    onLog: (line) => {
      void ctx.log('info', line, 'unix');
    },
  });

  const asset: MediaAssetRecord = {
    id,
    projectId: input.projectId,
    category: 'sequences',
    filename,
    mimeType: 'video/mp4',
    url: `/api/v1/media/sequences/${filename}`,
    sizeBytes: probe.sizeBytes,
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec,
    codec: probe.codec || 'h264',
    prompt: imageAsset.prompt || input.prompt,
    provider: 'harou-unix-5.8/ffmpeg-motion',
    metadata: {
      motion,
      imageAssetId: imageAsset.id,
      audioAssetId: input.audioAssetId,
    },
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.sequenceAssetIds.push(asset.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    98,
    'HAROU UNIX 5.8 — Séquence prête',
    `Séquence MP4 encodée (${probe.durationSec}s, ${Math.round(probe.sizeBytes / 1024)} Ko)`,
    'unix'
  );
  return asset;
}

export async function executeAssemblyCreation(
  ctx: TaskContext,
  input: {
    projectId?: string;
    sequenceAssetIds: string[];
    musicAudioAssetId?: string;
    transition?: TransitionPreset;
    transitionDurationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
  }
): Promise<MediaAssetRecord> {
  const sequencePaths: string[] = [];
  for (const seqId of input.sequenceAssetIds) {
    const asset = db.getAsset(seqId);
    if (!asset || asset.category !== 'sequences') {
      throw new Error(`Séquence vidéo introuvable : ${seqId}`);
    }
    const p = path.join(STORAGE_PATHS.sequences, asset.filename);
    if (!fs.existsSync(p)) {
      throw new Error(`Fichier séquence absent : ${asset.filename}`);
    }
    sequencePaths.push(p);
  }

  let musicAudioPath: string | undefined;
  if (input.musicAudioAssetId) {
    const m = db.getAsset(input.musicAudioAssetId);
    if (m) {
      const mp = path.join(STORAGE_PATHS.audio, m.filename);
      if (fs.existsSync(mp)) musicAudioPath = mp;
    }
  }

  const id = makeId('asm');
  const filename = `${id}.mp4`;
  const outputPath = path.join(STORAGE_PATHS.assemblies, filename);
  const transition = input.transition || 'fade';

  await ctx.setProgress(
    20,
    'HAROU UNIX 5.8 — Assemblage multi-scènes',
    `Montage FFmpeg xfade de ${sequencePaths.length} séquences (transition: ${transition})`,
    'unix'
  );

  const probe = await assembleScenes({
    sequencePaths,
    outputPath,
    transition,
    transitionDurationSec: input.transitionDurationSec || 0.6,
    width: input.width || 1280,
    height: input.height || 720,
    fps: input.fps || 24,
    musicAudioPath,
    onProgress: (pct) => {
      void ctx.setProgress(20 + Math.round(pct * 0.75), `HAROU UNIX 5.8 — Montage (${pct}%)`);
    },
    onLog: (line) => {
      void ctx.log('info', line, 'unix');
    },
  });

  const asset: MediaAssetRecord = {
    id,
    projectId: input.projectId,
    category: 'assemblies',
    filename,
    mimeType: 'video/mp4',
    url: `/api/v1/media/assemblies/${filename}`,
    sizeBytes: probe.sizeBytes,
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec,
    codec: probe.codec || 'h264',
    provider: 'harou-unix-5.8/ffmpeg-composer',
    metadata: {
      sequenceAssetIds: input.sequenceAssetIds,
      transition,
      transitionDurationSec: input.transitionDurationSec || 0.6,
    },
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.assemblyAssetId = asset.id;
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    98,
    'HAROU UNIX 5.8 — Assemblage terminé',
    `Timeline assemblée (${probe.durationSec}s, ${Math.round(probe.sizeBytes / 1024)} Ko)`,
    'unix'
  );
  return asset;
}

export async function executeExportMp4(
  ctx: TaskContext,
  input: {
    projectId?: string;
    sourceAssetId: string;
    profile?: ExportProfile;
    title?: string;
  }
): Promise<MediaAssetRecord> {
  const sourceAsset = db.getAsset(input.sourceAssetId);
  if (!sourceAsset) {
    throw new Error(`Ressource source introuvable pour l’export : ${input.sourceAssetId}`);
  }
  const sourcePath = path.join(STORAGE_PATHS[sourceAsset.category], sourceAsset.filename);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Fichier source absent sur le disque : ${sourceAsset.filename}`);
  }

  const profile: ExportProfile = input.profile || '720p';
  const id = makeId('exp');
  const filename = `${id}_${profile}.mp4`;
  const outputPath = path.join(STORAGE_PATHS.exports, filename);

  await ctx.setProgress(
    15,
    'HAROU UNIX 5.8 — Mastering MP4 final',
    `FFmpeg mastering profil ${profile} (-movflags +faststart)`,
    'unix'
  );

  const probe = await exportMasterMp4({
    inputPath: sourcePath,
    outputPath,
    profile,
    title: input.title,
    onProgress: (pct) => {
      void ctx.setProgress(15 + Math.round(pct * 0.8), `HAROU UNIX 5.8 — Export MP4 (${pct}%)`);
    },
    onLog: (line) => {
      void ctx.log('info', line, 'unix');
    },
  });

  const asset: MediaAssetRecord = {
    id,
    projectId: input.projectId,
    category: 'exports',
    filename,
    mimeType: 'video/mp4',
    url: `/api/v1/media/exports/${filename}`,
    sizeBytes: probe.sizeBytes,
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec,
    codec: probe.codec || 'h264',
    provider: 'harou-unix-5.8/ffmpeg-composer',
    metadata: {
      profile,
      sourceAssetId: sourceAsset.id,
      title: input.title,
    },
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (input.projectId) {
    const proj = await db.updateProject(input.projectId, (p) => {
      p.exportAssetId = asset.id;
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  await ctx.setProgress(
    98,
    'HAROU UNIX 5.8 — Film MP4 exporté',
    `Master MP4 prêt (${probe.width}x${probe.height}, ${probe.durationSec}s, ${Math.round(probe.sizeBytes / 1024)} Ko)`,
    'unix'
  );
  return asset;
}

export async function executeFullProductionPipeline(
  ctx: TaskContext,
  input: {
    projectId: string;
    projectName: string;
    prompt: string;
    genre?: string;
    tone?: string;
    visualStyle?: string;
    sceneCount?: number;
    language?: string;
    transition?: TransitionPreset;
    exportProfile?: ExportProfile;
    voiceName?: string;
    withVoice?: boolean;
  }
): Promise<Record<string, unknown>> {
  const proj = await db.updateProject(input.projectId, (p) => {
    p.status = 'producing';
    p.activeJobId = ctx.jobId;
  });
  if (proj) eventBus.emitProjectUpdate(proj);

  HarouTicTacMemory.upsertProjectStyle(input.projectId, input.visualStyle, input.prompt);

  // 1. HAROU DEVIN 2.0 — Scenario
  await ctx.setProgress(
    8,
    'HAROU DEVIN 2.0 (1/4) — Scénario',
    'Génération intelligente du découpage technique collaboratif...',
    'devin'
  );
  const scenario = await executeScenarioCreation(ctx, {
    projectId: input.projectId,
    prompt: input.prompt,
    genre: input.genre,
    tone: input.tone,
    visualStyle: input.visualStyle,
    sceneCount: input.sceneCount || 3,
    language: input.language || 'fr',
  });

  // 2. Character bible (main character if referenced)
  const uniqueSpeakers = Array.from(
    new Set(
      scenario.scenes
        .flatMap((s) => (s.characterNames.length ? s.characterNames : [s.speaker]))
        .filter((n) => n && n.toLowerCase() !== 'narrator' && n.toLowerCase() !== 'narrateur')
    )
  ).slice(0, 2);

  const characters: CharacterRecord[] = [];
  if (uniqueSpeakers.length > 0) {
    await ctx.setProgress(
      18,
      'HAROU TIC-TAC 3.7 (2/4) — Cohérence personnages',
      `Création et indexation mémoire de ${uniqueSpeakers.length} personnage(s)...`,
      'tic-tac'
    );
    for (const speakerName of uniqueSpeakers) {
      const chr = await executeCharacterCreation(ctx, {
        projectId: input.projectId,
        name: speakerName,
        concept: `${speakerName} dans l'histoire "${scenario.title}" (${scenario.logline})`,
        visualStyle: scenario.visualStyle,
        language: scenario.language,
        generatePortrait: true,
      });
      characters.push(chr);
    }
  }

  // 3 & 4. HAROU AILLEURS 4.6 + HAROU TIC-TAC 3.7 + HAROU UNIX 5.8 per-scene production
  const sequenceAssets: MediaAssetRecord[] = [];
  const totalScenes = scenario.scenes.length;

  for (let i = 0; i < totalScenes; i++) {
    const scene = scenario.scenes[i];
    const basePct = 25 + Math.round((i / totalScenes) * 50);

    await ctx.setProgress(
      basePct,
      `HAROU AILLEURS 4.6 (3/4) — Scène ${i + 1}/${totalScenes}`,
      `Génération visuelle avec cohérence TIC-TAC : ${scene.title}`,
      'ailleurs'
    );

    const anchorHints = characters
      .filter((c) =>
        scene.characterNames.some((n) => n.toLowerCase() === c.name.toLowerCase()) ||
        c.name.toLowerCase() === scene.speaker.toLowerCase()
      )
      .map((c) => c.visualPromptAnchor)
      .join(', ');

    const fullVisualPrompt = [
      scene.visualPrompt,
      anchorHints ? `featuring ${anchorHints}` : '',
      scenario.visualStyle,
      'cinematic film still, high detail, 16:9 composition',
    ]
      .filter(Boolean)
      .join(', ');

    const imgAsset = await executeImageCreation(ctx, {
      projectId: input.projectId,
      prompt: fullVisualPrompt,
      width: 1280,
      height: 720,
    });

    let audioAsset: MediaAssetRecord | undefined;
    if (input.withVoice !== false && scene.narrationOrDialogue?.trim()) {
      await ctx.setProgress(
        basePct + 6,
        `HAROU TIC-TAC 3.7 — Voix scène ${i + 1}/${totalScenes}`,
        `Synthèse voix : ${scene.speaker || 'Narrateur'}`,
        'tic-tac'
      );
      const matchedChar = characters.find(
        (c) => c.name.toLowerCase() === (scene.speaker || '').toLowerCase()
      );
      try {
        audioAsset = await executeAudioCreation(ctx, {
          projectId: input.projectId,
          text: scene.narrationOrDialogue,
          voiceName: matchedChar?.recommendedVoice || input.voiceName || 'Kore',
          style: matchedChar?.voiceStyle || 'Cinematic clear narrator',
          mode: 'single',
        });
      } catch (audioErr) {
        await ctx.log(
          'warn',
          `Synthèse vocale ignorée pour scène ${i + 1} (${audioErr instanceof Error ? audioErr.message : String(audioErr)}).`,
          'tic-tac'
        );
      }
    }

    await ctx.setProgress(
      basePct + 11,
      `HAROU UNIX 5.8 (4/4) — Séquence ${i + 1}/${totalScenes}`,
      `Rendu H.264 avec mouvement ${scene.cameraMovement}`,
      'unix'
    );

    const seqAsset = await executeVideoSequenceCreation(ctx, {
      projectId: input.projectId,
      imageAssetId: imgAsset.id,
      audioAssetId: audioAsset?.id,
      durationSec: scene.durationSec,
      width: 1280,
      height: 720,
      fps: 24,
      motion: scene.cameraMovement,
    });
    sequenceAssets.push(seqAsset);
  }

  // 5. HAROU UNIX 5.8 — Scene Assembly
  await ctx.setProgress(
    80,
    'HAROU UNIX 5.8 — Assemblage des scènes',
    'Montage FFmpeg xfade des séquences...',
    'unix'
  );
  const assemblyAsset = await executeAssemblyCreation(ctx, {
    projectId: input.projectId,
    sequenceAssetIds: sequenceAssets.map((s) => s.id),
    transition: input.transition || 'fade',
    transitionDurationSec: 0.6,
    width: 1280,
    height: 720,
    fps: 24,
  });

  // 6. HAROU UNIX 5.8 — MP4 Export
  await ctx.setProgress(
    91,
    'HAROU UNIX 5.8 — Exportation MP4',
    'Finalisation du fichier MP4...',
    'unix'
  );
  const exportAsset = await executeExportMp4(ctx, {
    projectId: input.projectId,
    sourceAssetId: assemblyAsset.id,
    profile: input.exportProfile || '720p',
    title: scenario.title,
  });

  const finishedProj = await db.updateProject(input.projectId, (p) => {
    p.status = 'completed';
    p.activeJobId = undefined;
  });
  if (finishedProj) eventBus.emitProjectUpdate(finishedProj);

  return {
    project: finishedProj,
    scenario,
    characters,
    sequenceAssetIds: sequenceAssets.map((s) => s.id),
    assemblyAsset,
    exportAsset,
  };
}

export function createProjectRecord(name: string, prompt: string): ProductionProject {
  const now = new Date().toISOString();
  return {
    id: makeId('prj'),
    name: name.trim() || 'Production HAROU',
    prompt,
    status: 'draft',
    characterIds: [],
    imageAssetIds: [],
    audioAssetIds: [],
    sequenceAssetIds: [],
    createdAt: now,
    updatedAt: now,
  };
}
