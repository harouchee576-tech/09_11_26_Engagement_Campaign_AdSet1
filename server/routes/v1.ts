import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import {
  DATA_DIR,
  getConfiguredCorsOrigins,
  getPublicBaseUrl,
  RATE_LIMIT_RPM,
  STORAGE_DIR,
  STORAGE_PATHS,
} from '../config.ts';
import { answerCreatorQuestion, getCreatorProfile } from '../creator.ts';
import { getUnifiedEnginesReport } from '../engines/diagnostics.ts';
import { classifyIntentToTask, HarouTicTacMemory, resolveEngineForTask } from '../engines/harou2.ts';
import { eventBus } from '../events.ts';
import { probeMedia } from '../ffmpeg.ts';
import { buildOpenApiSpec, renderOpenApiDocsHtml } from '../openapi.ts';
import { getProviderCatalogAsync } from '../providers/modular.ts';
import {
  apiRateLimiter,
  type AuthenticatedRequest,
  createApiKey,
  hasConfiguredEnvApiKeys,
  issueSignedMediaToken,
  issueStudioSessionToken,
  listApiKeys,
  requireAuth,
  revokeApiKey,
  STUDIO_COOKIE_NAME,
} from '../security.ts';
import { db } from '../store.ts';
import type { MediaCategory } from '../types.ts';
import {
  cancelJob,
  createProjectRecord,
  enqueueJob,
  executeAssemblyCreation,
  executeAudioCreation,
  executeCharacterCreation,
  executeExportMp4,
  executeFullProductionPipeline,
  executeImageCreation,
  executeScenarioCreation,
  executeVideoSequenceCreation,
} from '../workers/pipeline.ts';

export const studioRouter = Router();
export const v1Router = Router();

studioRouter.post('/session', (_req, res) => {
  const token = issueStudioSessionToken();
  res.cookie(STUDIO_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  });
  res.json({ authenticated: true, mode: 'studio_session' });
});

export async function handleHealthCheck(req: AuthenticatedRequest, res: import('express').Response) {
  const apiBase = `${getPublicBaseUrl(req)}/api/v1`;
  let storageWritable = false;
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    fs.accessSync(STORAGE_DIR, fs.constants.W_OK);
    storageWritable = true;
  } catch {
    storageWritable = false;
  }

  let ffmpegAvailable = false;
  let ffprobeAvailable = false;
  let operationalEngines = 0;
  let totalEngines = 4;
  try {
    const report = await getUnifiedEnginesReport();
    ffmpegAvailable = Boolean(report.hardware.ffmpegVersion);
    ffprobeAvailable = report.hardware.ffprobeAvailable;
    operationalEngines = report.engines.filter((e) => e.operational).length;
    totalEngines = report.engines.length;
  } catch {
    // keep false defaults if probe fails
  }

  const jobs = db.getAll().jobs;
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;
  const status = storageWritable && operationalEngines > 0 ? 'ok' : 'degraded';

  res.status(storageWritable ? 200 : 503).json({
    ok: storageWritable,
    status,
    engine: 'HAROU GENERATOR 2.0',
    version: '2.0.0',
    uptimeSec: Math.round(process.uptime()),
    apiBaseUrl: apiBase,
    openApiUrl: `${apiBase}/openapi.json`,
    docsUrl: `${apiBase}/docs`,
    checks: {
      storageWritable,
      ffmpegAvailable,
      ffprobeAvailable,
      operationalEngines,
      totalEngines,
      activeJobs,
    },
    timestamp: new Date().toISOString(),
  });
}

v1Router.get('/health', (req, res) => {
  void handleHealthCheck(req as AuthenticatedRequest, res);
});

v1Router.get('/openapi.json', (req, res) => {
  const apiBase = `${getPublicBaseUrl(req)}/api/v1`;
  res.json(buildOpenApiSpec(apiBase));
});

v1Router.get('/docs', (req, res) => {
  const apiBase = `${getPublicBaseUrl(req)}/api/v1`;
  res.type('html').send(renderOpenApiDocsHtml(apiBase));
});

// All endpoints below require either HAROU AI x-api-key / Bearer token OR Studio session cookie
v1Router.use(requireAuth);
v1Router.use(apiRateLimiter);

v1Router.get('/info', async (req: AuthenticatedRequest, res) => {
  const baseUrl = getPublicBaseUrl(req);
  const apiBase = `${baseUrl}/api/v1`;
  const report = await getUnifiedEnginesReport();
  const corsOrigins = getConfiguredCorsOrigins();
  res.json({
    engine: 'HAROU GENERATOR 2.0',
    version: '2.0.0',
    creator: getCreatorProfile(false),
    personalApiBaseUrl: apiBase,
    openApiUrl: `${apiBase}/openapi.json`,
    docsUrl: `${apiBase}/docs`,
    healthUrl: `${apiBase}/health`,
    deployment: {
      envApiKeyConfigured: hasConfiguredEnvApiKeys(),
      corsAllowedOrigins: corsOrigins.length > 0 ? corsOrigins : ['*'],
      rateLimitRpm: RATE_LIMIT_RPM,
      publicDeploymentReady: true,
    },
    auth: {
      headers: ['x-api-key', 'Authorization: Bearer <token>'],
      mode: req.authContext?.mode,
    },
    engines: report.engines,
    hardware: report.hardware,
    providers: report.providers,
    endpoints: [
      { method: 'GET', path: '/api/v1/health', description: 'Vérification publique de santé du serveur (sans authentification)' },
      { method: 'GET', path: '/api/v1/openapi.json', description: 'Spécification OpenAPI 3.1.0 JSON complète' },
      { method: 'GET', path: '/api/v1/docs', description: 'Documentation OpenAPI interactive dans le navigateur' },
      { method: 'GET', path: '/api/v1/info', description: 'Informations HAROU GENERATOR 2.0 et adresse API personnelle' },
      { method: 'GET', path: '/api/v1/engines', description: 'État réel des 4 moteurs (DEVIN 2.0, AILLEURS 4.6, TIC-TAC 3.7, UNIX 5.8) et matériel' },
      { method: 'POST', path: '/api/v1/dispatch', description: 'Dispatch central intelligent vers le moteur ou pipeline approprié' },
      { method: 'GET', path: '/api/v1/memory/:projectId', description: 'Mémoire partagée HAROU TIC-TAC 3.7 d’une production' },
      { method: 'GET', path: '/api/v1/creator', description: 'Identité du créateur HAROU CEE (profil public vérifié)' },
      { method: 'POST', path: '/api/v1/creator/ask', description: 'Questions sur le créateur sans fabrication' },
      { method: 'GET', path: '/api/v1/providers', description: 'Modules open-source et gratuits disponibles' },
      { method: 'POST', path: '/api/v1/scenarios', description: 'Envoi direct d’un scénario depuis HAROU AI' },
      { method: 'POST', path: '/api/v1/scenarios/generate', description: 'Génération intelligente de scénarios (HAROU DEVIN 2.0)' },
      { method: 'POST', path: '/api/v1/characters', description: 'Envoi direct d’un personnage depuis HAROU AI' },
      { method: 'POST', path: '/api/v1/characters/create', description: 'Création et ancrage personnages (HAROU TIC-TAC 3.7)' },
      { method: 'POST', path: '/api/v1/images/import', description: 'Import d’une image (base64/URL) depuis HAROU AI' },
      { method: 'POST', path: '/api/v1/images/generate', description: 'Génération d’images open-source (HAROU AILLEURS 4.6)' },
      { method: 'POST', path: '/api/v1/audio/generate', description: 'Création de voix et dialogues WAV (HAROU TIC-TAC 3.7)' },
      { method: 'POST', path: '/api/v1/videos/generate', description: 'Génération de séquences vidéo MP4 (HAROU UNIX 5.8)' },
      { method: 'POST', path: '/api/v1/assemblies/create', description: 'Assemblage automatique des scènes (HAROU UNIX 5.8)' },
      { method: 'POST', path: '/api/v1/exports/mp4', description: 'Exportation et mastering MP4 (HAROU UNIX 5.8)' },
      { method: 'POST', path: '/api/v1/pipeline/produce', description: 'Pipeline complet collaboratif 4 moteurs de bout en bout' },
      { method: 'POST', path: '/api/v1/media/sign', description: 'Génère une URL média signée temporaire pour Lovable / client web' },
      { method: 'GET', path: '/api/v1/jobs', description: 'Suivi de la file de tâches et progression' },
      { method: 'GET', path: '/api/v1/events', description: 'Flux SSE temps réel des productions' },
    ],
  });
});

v1Router.get('/engines', async (_req, res) => {
  const report = await getUnifiedEnginesReport();
  res.json(report);
});

v1Router.get('/memory/:projectId', (req, res) => {
  const memory = HarouTicTacMemory.getContext(req.params.projectId);
  res.json({ memory: memory || null });
});

v1Router.get('/creator', (req, res) => {
  const ownerAuthorized =
    req.headers['x-owner-authorized'] === 'true' && req.query.includeConfidential === 'true';
  res.json({ creator: getCreatorProfile(ownerAuthorized) });
});

v1Router.post('/creator/ask', (req, res) => {
  const question =
    typeof req.body?.question === 'string' && req.body.question.trim()
      ? req.body.question.trim()
      : 'Qui est ton créateur ?';
  const ownerAuthorized =
    req.headers['x-owner-authorized'] === 'true' && req.body?.includeConfidential === true;
  res.json(answerCreatorQuestion(question, ownerAuthorized));
});

v1Router.get('/providers', async (_req, res) => {
  const providers = await getProviderCatalogAsync();
  res.json({ providers });
});

v1Router.get('/events', (req, res) => {
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : undefined;
  const unregister = eventBus.registerClient(res, jobId);
  req.on('close', unregister);
});

// API Keys for HAROU AI
v1Router.get('/keys', (_req, res) => {
  res.json({ keys: listApiKeys() });
});

v1Router.post('/keys', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : 'HAROU AI Client';
  const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : ['*'];
  const created = createApiKey(name, scopes);
  res.status(201).json({
    key: created.record,
    plaintextKey: created.plaintextKey,
    note: 'Copiez cette clé maintenant : elle ne sera plus réaffichée en clair.',
  });
});

v1Router.delete('/keys/:id', (req, res) => {
  const ok = revokeApiKey(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found', message: 'Clé API introuvable.' });
    return;
  }
  res.json({ revoked: true, id: req.params.id });
});

// Jobs
v1Router.get('/jobs', (req, res) => {
  let jobs = db.getAll().jobs;
  if (typeof req.query.status === 'string' && req.query.status !== 'all') {
    jobs = jobs.filter((j) => j.status === req.query.status);
  }
  if (typeof req.query.type === 'string' && req.query.type !== 'all') {
    jobs = jobs.filter((j) => j.type === req.query.type);
  }
  if (typeof req.query.projectId === 'string') {
    jobs = jobs.filter((j) => j.projectId === req.query.projectId);
  }
  res.json({ jobs });
});

v1Router.get('/jobs/:id', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'not_found', message: 'Tâche introuvable.' });
    return;
  }
  res.json({ job });
});

v1Router.post('/jobs/:id/cancel', async (req, res) => {
  const job = await cancelJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'not_found', message: 'Tâche introuvable.' });
    return;
  }
  res.json({ job });
});

// Projects / Production Tracking
v1Router.get('/projects', (_req, res) => {
  res.json({ projects: db.getAll().projects });
});

v1Router.post('/projects', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : 'Nouvelle Production';
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  const project = createProjectRecord(name, prompt);
  await db.createProject(project);
  eventBus.emitProjectUpdate(project);
  res.status(201).json({ project });
});

v1Router.get('/projects/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'not_found', message: 'Production introuvable.' });
    return;
  }
  const state = db.getAll();
  res.json({
    project,
    scenario: project.scenarioId ? db.getScenario(project.scenarioId) : undefined,
    characters: state.characters.filter((c) => project.characterIds.includes(c.id)),
    assets: state.assets.filter((a) => a.projectId === project.id),
    jobs: state.jobs.filter((j) => j.projectId === project.id),
  });
});

// 1. Scenarios
v1Router.get('/scenarios', (_req, res) => {
  res.json({ scenarios: db.getAll().scenarios });
});

v1Router.post('/scenarios', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const scenes = Array.isArray(req.body?.scenes) ? req.body.scenes : [];
  if (!title || scenes.length === 0) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Les champs title et scenes (tableau non vide) sont requis.',
    });
    return;
  }
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const totalDurationSec = scenes.reduce(
    (sum: number, sc: { durationSec?: number }) => sum + (Number(sc.durationSec) || 6),
    0
  );
  const scenario = {
    id: `scn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    projectId,
    title,
    logline: typeof req.body?.logline === 'string' ? req.body.logline : title,
    genre: typeof req.body?.genre === 'string' ? req.body.genre : 'Cinéma',
    tone: typeof req.body?.tone === 'string' ? req.body.tone : 'Cinématique',
    visualStyle: typeof req.body?.visualStyle === 'string' ? req.body.visualStyle : 'Cinéma 35mm',
    language: typeof req.body?.language === 'string' ? req.body.language : 'fr',
    provider: 'harou-ai-input',
    totalDurationSec,
    scenes,
    createdAt: new Date().toISOString(),
  };
  await db.addScenario(scenario);
  HarouTicTacMemory.registerScenario(projectId, scenario);
  if (projectId) {
    const proj = await db.updateProject(projectId, (p) => {
      p.scenarioId = scenario.id;
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  res.status(201).json({ scenario });
});

v1Router.post('/scenarios/generate', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis.' });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'auto';
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'scenario',
    provider,
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const scenario = await executeScenarioCreation(ctx, {
        projectId,
        provider,
        prompt,
        genre: req.body?.genre,
        tone: req.body?.tone,
        visualStyle: req.body?.visualStyle,
        sceneCount: req.body?.sceneCount,
        language: req.body?.language,
      });
      return { scenario };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 2. Characters
v1Router.get('/characters', (_req, res) => {
  res.json({ characters: db.getAll().characters });
});

v1Router.post('/characters', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ name est requis.' });
    return;
  }
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] as const;
  const recommendedVoice = allowedVoices.includes(req.body?.recommendedVoice)
    ? req.body.recommendedVoice
    : 'Kore';

  const character = {
    id: `chr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    projectId,
    name,
    role: typeof req.body?.role === 'string' ? req.body.role : 'Personnage',
    age: typeof req.body?.age === 'string' ? req.body.age : 'Adulte',
    physicalDescription:
      typeof req.body?.physicalDescription === 'string' ? req.body.physicalDescription : name,
    wardrobe: typeof req.body?.wardrobe === 'string' ? req.body.wardrobe : 'Tenue sobre',
    personality: typeof req.body?.personality === 'string' ? req.body.personality : 'Expressif',
    voiceStyle: typeof req.body?.voiceStyle === 'string' ? req.body.voiceStyle : 'Claire et posée',
    recommendedVoice,
    visualPromptAnchor:
      typeof req.body?.visualPromptAnchor === 'string' ? req.body.visualPromptAnchor : name,
    portraitAssetId: typeof req.body?.portraitAssetId === 'string' ? req.body.portraitAssetId : undefined,
    portraitUrl: typeof req.body?.portraitUrl === 'string' ? req.body.portraitUrl : undefined,
    provider: 'harou-ai-input',
    createdAt: new Date().toISOString(),
  };
  await db.addCharacter(character);
  HarouTicTacMemory.registerCharacter(projectId, character);
  if (projectId) {
    const proj = await db.updateProject(projectId, (p) => {
      p.characterIds.push(character.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  res.status(201).json({ character });
});

v1Router.post('/characters/create', async (req, res) => {
  const concept = typeof req.body?.concept === 'string' ? req.body.concept.trim() : '';
  if (!concept) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ concept est requis.' });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'auto';
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'character',
    provider,
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const character = await executeCharacterCreation(ctx, {
        projectId,
        provider,
        imageProvider: req.body?.imageProvider,
        name: req.body?.name,
        concept,
        role: req.body?.role,
        visualStyle: req.body?.visualStyle,
        language: req.body?.language,
        generatePortrait: req.body?.generatePortrait !== false,
      });
      return { character };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 3. Images
v1Router.get('/images', (_req, res) => {
  const images = db.getAll().assets.filter((a) => a.category === 'images');
  res.json({ images });
});

v1Router.post('/images/import', async (req, res) => {
  const base64Input = typeof req.body?.base64 === 'string' ? req.body.base64.trim() : '';
  const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl.trim() : '';
  if (!base64Input && !sourceUrl) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Fournissez base64 ou sourceUrl pour importer une image.',
    });
    return;
  }

  let buffer: Buffer;
  let ext = 'jpg';
  let mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'image/jpeg';

  if (base64Input) {
    const match = base64Input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    const cleanB64 = match ? match[2] : base64Input;
    if (match) mimeType = match[1];
    ext = mimeType.includes('png') ? 'png' : 'jpg';
    buffer = Buffer.from(cleanB64, 'base64');
  } else {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) {
      res.status(400).json({
        error: 'fetch_failed',
        message: `Impossible de récupérer l’image distante (HTTP ${imgRes.status}).`,
      });
      return;
    }
    mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    ext = mimeType.includes('png') ? 'png' : 'jpg';
    buffer = Buffer.from(await imgRes.arrayBuffer());
  }

  if (buffer.length < 100) {
    res.status(400).json({ error: 'invalid_image', message: 'Image importée vide ou invalide.' });
    return;
  }

  const id = `img_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const filename = `${id}.${ext}`;
  const outputPath = path.join(STORAGE_PATHS.images, filename);
  await fs.promises.writeFile(outputPath, buffer);

  let width: number | undefined;
  let height: number | undefined;
  try {
    const probed = await probeMedia(outputPath);
    width = probed.width;
    height = probed.height;
  } catch {
    // ignore optional probe error
  }

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const asset = {
    id,
    projectId,
    category: 'images' as const,
    filename,
    mimeType,
    url: `/api/v1/media/images/${filename}`,
    sizeBytes: buffer.length,
    width,
    height,
    prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : 'Image importée depuis HAROU AI',
    provider: 'harou-ai-input',
    createdAt: new Date().toISOString(),
  };

  await db.addAsset(asset);
  if (projectId) {
    const proj = await db.updateProject(projectId, (p) => {
      p.imageAssetIds.push(asset.id);
    });
    if (proj) eventBus.emitProjectUpdate(proj);
  }
  res.status(201).json({ asset });
});

v1Router.post('/images/generate', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis.' });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'auto';
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'image',
    provider,
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const asset = await executeImageCreation(ctx, {
        projectId,
        provider,
        prompt,
        width: req.body?.width,
        height: req.body?.height,
        seed: req.body?.seed,
      });
      return { asset };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 4. Audio (Voice & Dialogue)
v1Router.get('/audio', (_req, res) => {
  const audio = db.getAll().assets.filter((a) => a.category === 'audio');
  res.json({ audio });
});

v1Router.post('/audio/generate', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const hasSpeakers = Array.isArray(req.body?.speakers) && req.body.speakers.length === 2;
  if (!text && !hasSpeakers) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Fournissez text (mono-locuteur) ou speakers (tableau de 2 répliques).',
    });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'auto';
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'audio',
    provider,
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const asset = await executeAudioCreation(ctx, {
        projectId,
        provider,
        text: text || req.body.speakers.map((s: { speaker: string; text: string }) => `${s.speaker}: ${s.text}`).join(' '),
        voiceName: req.body?.voiceName,
        style: req.body?.style,
        language: req.body?.language,
        mode: hasSpeakers ? 'dialogue' : 'single',
        speakers: req.body?.speakers,
      });
      return { asset };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 5. Video Sequences
v1Router.get('/videos', (_req, res) => {
  const sequences = db.getAll().assets.filter((a) => a.category === 'sequences');
  res.json({ sequences });
});

v1Router.post('/videos/generate', async (req, res) => {
  const imageAssetId = typeof req.body?.imageAssetId === 'string' ? req.body.imageAssetId : undefined;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : undefined;
  if (!imageAssetId && !prompt) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Fournissez imageAssetId ou prompt pour générer la séquence vidéo.',
    });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'video',
    provider: 'ffmpeg-motion',
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const asset = await executeVideoSequenceCreation(ctx, {
        projectId,
        imageAssetId,
        prompt,
        audioAssetId: req.body?.audioAssetId,
        durationSec: req.body?.durationSec,
        width: req.body?.width,
        height: req.body?.height,
        fps: req.body?.fps,
        motion: req.body?.motion,
      });
      return { asset };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 6. Scene Assembly
v1Router.get('/assemblies', (_req, res) => {
  const assemblies = db.getAll().assets.filter((a) => a.category === 'assemblies');
  res.json({ assemblies });
});

v1Router.post('/assemblies/create', async (req, res) => {
  const sequenceAssetIds = Array.isArray(req.body?.sequenceAssetIds)
    ? req.body.sequenceAssetIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  if (sequenceAssetIds.length === 0) {
    res.status(400).json({
      error: 'validation_error',
      message: 'sequenceAssetIds (tableau non vide) est requis.',
    });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'assembly',
    provider: 'ffmpeg-composer',
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const asset = await executeAssemblyCreation(ctx, {
        projectId,
        sequenceAssetIds,
        musicAudioAssetId: req.body?.musicAudioAssetId,
        transition: req.body?.transition,
        transitionDurationSec: req.body?.transitionDurationSec,
        width: req.body?.width,
        height: req.body?.height,
        fps: req.body?.fps,
      });
      return { asset };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// 7. MP4 Export
v1Router.get('/exports', (_req, res) => {
  const exportsList = db.getAll().assets.filter((a) => a.category === 'exports');
  res.json({ exports: exportsList });
});

v1Router.post('/exports/mp4', async (req, res) => {
  const sourceAssetId = typeof req.body?.sourceAssetId === 'string' ? req.body.sourceAssetId : '';
  if (!sourceAssetId) {
    res.status(400).json({
      error: 'validation_error',
      message: 'sourceAssetId est requis pour exporter en MP4.',
    });
    return;
  }
  const sync = req.query.sync === 'true' || req.body?.sync === true;
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;

  const { job, completion } = await enqueueJob({
    type: 'export',
    provider: 'ffmpeg-composer',
    projectId,
    webhookUrl,
    input: req.body,
    run: async (ctx) => {
      const asset = await executeExportMp4(ctx, {
        projectId,
        sourceAssetId,
        profile: req.body?.profile,
        title: req.body?.title,
      });
      return { asset };
    },
  });

  if (sync) {
    const done = await completion;
    res.status(done.status === 'completed' ? 201 : 500).json({ job: done, ...(done.output || {}) });
    return;
  }
  res.status(202).json({ job });
});

// Central Intelligent Dispatcher for HAROU GENERATOR 2.0
v1Router.post('/dispatch', async (req, res) => {
  const body = req.body || {};
  const taskKind = classifyIntentToTask({
    task: typeof body.task === 'string' ? body.task : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    sequenceAssetIds: Array.isArray(body.sequenceAssetIds) ? body.sequenceAssetIds : undefined,
    sourceAssetId: typeof body.sourceAssetId === 'string' ? body.sourceAssetId : undefined,
    imageAssetId: typeof body.imageAssetId === 'string' ? body.imageAssetId : undefined,
  });
  const dispatch = resolveEngineForTask(taskKind);
  const sync = req.query.sync === 'true' || body.sync === true;
  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
  const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl : undefined;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  if (taskKind === 'scenario') {
    if (!prompt) {
      res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis pour HAROU DEVIN 2.0.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'scenario',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        scenario: await executeScenarioCreation(ctx, {
          projectId,
          provider: typeof body.provider === 'string' ? body.provider : 'auto',
          prompt,
          genre: body.genre,
          tone: body.tone,
          visualStyle: body.visualStyle,
          sceneCount: body.sceneCount,
          language: body.language,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'character') {
    const concept = typeof body.concept === 'string' && body.concept.trim() ? body.concept.trim() : prompt;
    if (!concept) {
      res.status(400).json({ error: 'validation_error', message: 'Le champ concept ou prompt est requis pour HAROU TIC-TAC 3.7.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'character',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        character: await executeCharacterCreation(ctx, {
          projectId,
          provider: typeof body.provider === 'string' ? body.provider : 'auto',
          imageProvider: body.imageProvider,
          name: body.name,
          concept,
          role: body.role,
          visualStyle: body.visualStyle,
          language: body.language,
          generatePortrait: body.generatePortrait !== false,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'image') {
    if (!prompt) {
      res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis pour HAROU AILLEURS 4.6.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'image',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        asset: await executeImageCreation(ctx, {
          projectId,
          provider: typeof body.provider === 'string' ? body.provider : 'auto',
          prompt,
          width: body.width,
          height: body.height,
          seed: body.seed,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'audio') {
    const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim() : prompt;
    const hasSpeakers = Array.isArray(body.speakers) && body.speakers.length === 2;
    if (!text && !hasSpeakers) {
      res.status(400).json({ error: 'validation_error', message: 'Fournissez text, prompt ou speakers pour HAROU TIC-TAC 3.7.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'audio',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        asset: await executeAudioCreation(ctx, {
          projectId,
          provider: typeof body.provider === 'string' ? body.provider : 'auto',
          text: text || body.speakers.map((s: { speaker: string; text: string }) => `${s.speaker}: ${s.text}`).join(' '),
          voiceName: body.voiceName,
          style: body.style,
          language: body.language,
          mode: hasSpeakers ? 'dialogue' : 'single',
          speakers: body.speakers,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'video') {
    const imageAssetId = typeof body.imageAssetId === 'string' ? body.imageAssetId : undefined;
    if (!imageAssetId && !prompt) {
      res.status(400).json({ error: 'validation_error', message: 'Fournissez imageAssetId ou prompt pour HAROU UNIX 5.8.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'video',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        asset: await executeVideoSequenceCreation(ctx, {
          projectId,
          imageAssetId,
          prompt: prompt || undefined,
          audioAssetId: body.audioAssetId,
          durationSec: body.durationSec,
          width: body.width,
          height: body.height,
          fps: body.fps,
          motion: body.motion,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'assembly') {
    const sequenceAssetIds = Array.isArray(body.sequenceAssetIds)
      ? body.sequenceAssetIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    if (sequenceAssetIds.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'sequenceAssetIds est requis pour HAROU UNIX 5.8.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'assembly',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        asset: await executeAssemblyCreation(ctx, {
          projectId,
          sequenceAssetIds,
          musicAudioAssetId: body.musicAudioAssetId,
          transition: body.transition,
          transitionDurationSec: body.transitionDurationSec,
          width: body.width,
          height: body.height,
          fps: body.fps,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  if (taskKind === 'export') {
    const sourceAssetId = typeof body.sourceAssetId === 'string' ? body.sourceAssetId : '';
    if (!sourceAssetId) {
      res.status(400).json({ error: 'validation_error', message: 'sourceAssetId est requis pour HAROU UNIX 5.8.' });
      return;
    }
    const { job, completion } = await enqueueJob({
      type: 'export',
      provider: dispatch.engineId,
      projectId,
      webhookUrl,
      input: { ...body, dispatch },
      run: async (ctx) => ({
        asset: await executeExportMp4(ctx, {
          projectId,
          sourceAssetId,
          profile: body.profile,
          title: body.title,
        }),
      }),
    });
    if (sync) {
      const done = await completion;
      res.status(done.status === 'completed' ? 201 : 500).json({ dispatch, job: done, ...(done.output || {}) });
      return;
    }
    res.status(202).json({ dispatch, job });
    return;
  }

  // Default: full collaborative 4-engine film pipeline
  if (!prompt) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis pour produire un film complet.' });
    return;
  }
  const projectName =
    typeof body.projectName === 'string' && body.projectName.trim()
      ? body.projectName.trim()
      : prompt.slice(0, 48);
  const project = createProjectRecord(projectName, prompt);
  await db.createProject(project);
  eventBus.emitProjectUpdate(project);

  const { job } = await enqueueJob({
    type: 'pipeline',
    provider: dispatch.engineId,
    projectId: project.id,
    webhookUrl,
    input: { ...body, dispatch },
    run: (ctx) =>
      executeFullProductionPipeline(ctx, {
        projectId: project.id,
        projectName,
        prompt,
        genre: body.genre,
        tone: body.tone,
        visualStyle: body.visualStyle,
        sceneCount: body.sceneCount,
        language: body.language,
        transition: body.transition,
        exportProfile: body.exportProfile,
        voiceName: body.voiceName,
        withVoice: body.withVoice !== false,
      }),
  });

  res.status(202).json({ dispatch, project, job });
});

// Full Automated End-to-End Pipeline for HAROU AI
v1Router.post('/pipeline/produce', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'validation_error', message: 'Le champ prompt est requis.' });
    return;
  }
  const projectName =
    typeof req.body?.projectName === 'string' && req.body.projectName.trim()
      ? req.body.projectName.trim()
      : prompt.slice(0, 48);

  const project = createProjectRecord(projectName, prompt);
  await db.createProject(project);
  eventBus.emitProjectUpdate(project);

  const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;
  const { job } = await enqueueJob({
    type: 'pipeline',
    provider: 'harou-generator-2.0',
    projectId: project.id,
    webhookUrl,
    input: req.body,
    run: (ctx) =>
      executeFullProductionPipeline(ctx, {
        projectId: project.id,
        projectName,
        prompt,
        genre: req.body?.genre,
        tone: req.body?.tone,
        visualStyle: req.body?.visualStyle,
        sceneCount: req.body?.sceneCount,
        language: req.body?.language,
        transition: req.body?.transition,
        exportProfile: req.body?.exportProfile,
        voiceName: req.body?.voiceName,
        withVoice: req.body?.withVoice !== false,
      }),
  });

  res.status(202).json({ project, job });
});

// Short-lived signed URL generator for safe <video>/<img> playback in Lovable / external frontends
v1Router.post('/media/sign', (req, res) => {
  const category = typeof req.body?.category === 'string' ? req.body.category : '';
  const filename = typeof req.body?.filename === 'string' ? path.basename(req.body.filename) : '';
  if (!(category in STORAGE_PATHS) || !filename) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Fournissez category (images|audio|sequences|assemblies|exports) et filename valides.',
    });
    return;
  }
  const fullPath = path.join(STORAGE_PATHS[category as MediaCategory], filename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'not_found', message: 'Fichier média introuvable.' });
    return;
  }
  const ttlSec = typeof req.body?.ttlSec === 'number' ? req.body.ttlSec : 3600;
  const { token, expiresAt } = issueSignedMediaToken(category, filename, ttlSec);
  const signedUrl = `${getPublicBaseUrl(req)}/api/v1/media/${category}/${filename}?token=${encodeURIComponent(token)}`;
  res.json({ signedUrl, expiresAt });
});

// Media streaming with HTTP Range support for MP4/WAV/JPG
v1Router.get('/media/:category/:filename', (req, res) => {
  const category = req.params.category as MediaCategory;
  if (!(category in STORAGE_PATHS)) {
    res.status(404).json({ error: 'not_found', message: 'Catégorie média invalide.' });
    return;
  }

  const safeFilename = path.basename(req.params.filename);
  const fullPath = path.join(STORAGE_PATHS[category], safeFilename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'not_found', message: 'Fichier média introuvable.' });
    return;
  }

  const stat = fs.statSync(fullPath);
  const ext = path.extname(safeFilename).toLowerCase();
  const mime =
    ext === '.mp4'
      ? 'video/mp4'
      : ext === '.wav'
        ? 'audio/wav'
        : ext === '.png'
          ? 'image/png'
          : 'image/jpeg';

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  }

  const range = req.headers.range;
  if (range && (ext === '.mp4' || ext === '.wav')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = Number.parseInt(parts[0], 10);
    const end = parts[1] ? Number.parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });
    fs.createReadStream(fullPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(fullPath).pipe(res);
});
