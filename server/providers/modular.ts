import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { concatAudioFilesToWav } from '../ffmpeg.ts';
import type { MotionPreset, ProviderDescriptor, ScenarioScene } from '../types.ts';
import {
  generateCharacterWithGemini,
  generateScenarioWithGemini,
  generateSpeechWithGemini,
} from './gemini.ts';

const execFileAsync = promisify(execFile);

export interface ScenarioResult {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  visualStyle: string;
  scenes: ScenarioScene[];
}

export interface CharacterResult {
  name: string;
  role: string;
  age: string;
  physicalDescription: string;
  wardrobe: string;
  personality: string;
  voiceStyle: string;
  recommendedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  visualPromptAnchor: string;
}

interface RuntimeProbeCache {
  checkedAt: number;
  ollamaUrl: string | null;
  comfyUrl: string | null;
  sdWebuiUrl: string | null;
  piperBin: string | null;
  espeakBin: string | null;
  ffmpegBin: string | null;
}

let probeCache: RuntimeProbeCache | null = null;

function hasValidEnv(name: string, placeholder?: string): boolean {
  const val = process.env[name]?.trim();
  return Boolean(val && val !== placeholder);
}

async function findBinary(candidates: string[]): Promise<string | null> {
  for (const bin of candidates) {
    if (!bin) continue;
    if (path.isAbsolute(bin) && fs.existsSync(bin)) return bin;
    try {
      const { stdout } = await execFileAsync('which', [bin]);
      const resolved = stdout.trim().split('\n')[0]?.trim();
      if (resolved) return resolved;
    } catch {
      // not found
    }
  }
  return null;
}

async function isHttpReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 550);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function detectRuntime(): Promise<RuntimeProbeCache> {
  if (probeCache && Date.now() - probeCache.checkedAt < 2_500) {
    return probeCache;
  }

  const ollamaCandidate =
    process.env.OLLAMA_BASE_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  const comfyCandidate =
    process.env.COMFYUI_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8188';
  const sdCandidate =
    process.env.SD_WEBUI_URL?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:7860';

  const [ollamaOk, comfyOk, sdOk, piperBin, espeakBin, ffmpegBin] = await Promise.all([
    isHttpReachable(`${ollamaCandidate}/api/tags`),
    isHttpReachable(`${comfyCandidate}/system_stats`),
    isHttpReachable(`${sdCandidate}/sdapi/v1/options`),
    findBinary([process.env.PIPER_BIN?.trim() || '', 'piper']),
    findBinary([process.env.ESPEAK_BIN?.trim() || '', 'espeak-ng', 'espeak']),
    findBinary(['ffmpeg']),
  ]);

  probeCache = {
    checkedAt: Date.now(),
    ollamaUrl: ollamaOk ? ollamaCandidate : null,
    comfyUrl: comfyOk ? comfyCandidate : null,
    sdWebuiUrl: sdOk ? sdCandidate : null,
    piperBin,
    espeakBin,
    ffmpegBin,
  };
  return probeCache;
}

export async function getProviderCatalogAsync(): Promise<ProviderDescriptor[]> {
  const rt = await detectRuntime();
  const geminiReady = hasValidEnv('GEMINI_API_KEY', 'MY_GEMINI_API_KEY');
  const hfReady = hasValidEnv('HF_TOKEN');
  const piperModelReady = Boolean(
    rt.piperBin && process.env.PIPER_MODEL?.trim() && fs.existsSync(process.env.PIPER_MODEL.trim())
  );

  return [
    {
      id: 'ollama-local',
      name: `Ollama Open-Source Local (${process.env.OLLAMA_MODEL || 'llama3.2'})`,
      capability: 'scenario',
      license: 'open-source',
      available: Boolean(rt.ollamaUrl),
      reason: rt.ollamaUrl
        ? `Actif sur ${rt.ollamaUrl}`
        : 'Non détecté localement (bascule automatique vers Pollinations / Gemini)',
      envOrBinary: 'OLLAMA_BASE_URL (optionnel)',
      isDefault: Boolean(rt.ollamaUrl),
      installGuide: {
        summary: 'Exécute Llama 3.2, Mistral ou Qwen 2.5 localement sans clé ni quota.',
        commands: [
          'curl -fsSL https://ollama.com/install.sh | sh',
          'ollama pull llama3.2',
          'ollama serve',
        ],
        envVars: ['OLLAMA_BASE_URL=http://127.0.0.1:11434', 'OLLAMA_MODEL=llama3.2'],
      },
    },
    {
      id: 'pollinations-text',
      name: 'Pollinations Open LLM (Gratuit sans clé)',
      capability: 'scenario',
      license: 'open-source',
      available: true,
      reason: 'Actif sans aucune variable d’environnement',
      envOrBinary: 'Aucune configuration requise',
      isDefault: !rt.ollamaUrl && !geminiReady,
      installGuide: {
        summary: 'Endpoint gratuit prêt à l’emploi utilisé en secours automatique si aucun LLM local n’est démarré.',
        commands: ['# Aucune installation requise — actif par défaut'],
        envVars: [],
      },
    },
    {
      id: 'gemini-free',
      name: 'Gemini 4 Hydrogen (Tier Gratuit)',
      capability: 'scenario',
      license: 'free-tier',
      available: geminiReady,
      reason: geminiReady
        ? 'GEMINI_API_KEY optionnelle active côté serveur'
        : 'Optionnel — non configuré (alternatif Pollinations / Ollama actif)',
      envOrBinary: 'GEMINI_API_KEY (optionnel)',
      isDefault: geminiReady && !rt.ollamaUrl,
      installGuide: {
        summary: 'Modèle texte rapide JSON structuré (gratuit avec clé serveur optionnelle).',
        commands: ['# Ajoutez GEMINI_API_KEY dans Settings > Secrets ou .env'],
        envVars: ['GEMINI_API_KEY=...'],
      },
    },
    {
      id: 'huggingface-free',
      name: 'Hugging Face Open Inference (Qwen 2.5)',
      capability: 'scenario',
      license: 'open-source',
      available: hfReady,
      reason: hfReady
        ? 'HF_TOKEN optionnel actif côté serveur'
        : 'Optionnel — non configuré',
      envOrBinary: 'HF_TOKEN (optionnel)',
      isDefault: false,
      installGuide: {
        summary: 'Inférence gratuite des modèles open-weights Hugging Face.',
        commands: ['# Créez un token gratuit sur huggingface.co/settings/tokens'],
        envVars: ['HF_TOKEN=hf_...'],
      },
    },
    {
      id: 'comfyui-local',
      name: 'ComfyUI Local Open-Source (SDXL / FLUX)',
      capability: 'image',
      license: 'open-source',
      available: Boolean(rt.comfyUrl),
      reason: rt.comfyUrl
        ? `Actif sur ${rt.comfyUrl}`
        : 'Non détecté localement (bascule automatique vers Pollinations FLUX)',
      envOrBinary: 'COMFYUI_URL (optionnel)',
      isDefault: Boolean(rt.comfyUrl),
      installGuide: {
        summary: 'Génération d’images locale illimitée sur GPU avec modèles open-source.',
        commands: [
          'git clone https://github.com/comfyanonymous/ComfyUI.git',
          'cd ComfyUI && pip install -r requirements.txt',
          'python3 main.py --listen 0.0.0.0 --port 8188',
        ],
        envVars: ['COMFYUI_URL=http://127.0.0.1:8188', 'COMFYUI_CHECKPOINT=v1-5-pruned-emaonly.safetensors'],
      },
    },
    {
      id: 'sd-webui-local',
      name: 'Stable Diffusion WebUI / Forge Local',
      capability: 'image',
      license: 'open-source',
      available: Boolean(rt.sdWebuiUrl),
      reason: rt.sdWebuiUrl
        ? `Actif sur ${rt.sdWebuiUrl}`
        : 'Optionnel — non détecté localement',
      envOrBinary: 'SD_WEBUI_URL (optionnel)',
      isDefault: false,
      installGuide: {
        summary: 'Serveur local Automatic1111 / Forge avec API REST activée (--api).',
        commands: [
          'git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git',
          './webui.sh --api --listen --port 7860',
        ],
        envVars: ['SD_WEBUI_URL=http://127.0.0.1:7860'],
      },
    },
    {
      id: 'pollinations-flux',
      name: 'Pollinations FLUX / Turbo (Gratuit sans clé)',
      capability: 'image',
      license: 'open-source',
      available: true,
      reason: 'Actif par défaut sans clé ni GPU local',
      envOrBinary: 'Aucune configuration requise',
      isDefault: !rt.comfyUrl && !rt.sdWebuiUrl,
      installGuide: {
        summary: 'Génération FLUX / SDXL Turbo gratuite utilisée automatiquement si aucun GPU local n’est détecté.',
        commands: ['# Aucune installation requise — actif par défaut'],
        envVars: [],
      },
    },
    {
      id: 'huggingface-flux',
      name: 'Hugging Face FLUX.1-schnell',
      capability: 'image',
      license: 'open-source',
      available: hfReady,
      reason: hfReady ? 'HF_TOKEN optionnel actif' : 'Optionnel — non configuré',
      envOrBinary: 'HF_TOKEN (optionnel)',
      isDefault: false,
      installGuide: {
        summary: 'Inférence FLUX.1-schnell via token Hugging Face gratuit.',
        commands: ['# Créez un token gratuit sur huggingface.co/settings/tokens'],
        envVars: ['HF_TOKEN=hf_...'],
      },
    },
    {
      id: 'piper-local',
      name: 'Piper TTS Open-Source (Voix Neuronale Locale)',
      capability: 'audio',
      license: 'open-source',
      available: piperModelReady,
      reason: piperModelReady
        ? `Actif (${rt.piperBin})`
        : 'Optionnel — non installé (bascule automatique vers eSpeak / Gemini / TTS gratuit)',
      envOrBinary: 'PIPER_BIN + PIPER_MODEL (optionnels)',
      isDefault: piperModelReady,
      installGuide: {
        summary: 'Synthèse vocale neuronale ultra-rapide et 100% hors-ligne en français et anglais.',
        commands: [
          'pip install piper-tts',
          'mkdir -p models/piper && curl -L -o models/piper/fr_FR-upmc-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
          'curl -L -o models/piper/fr_FR-upmc-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx.json',
        ],
        envVars: ['PIPER_BIN=piper', 'PIPER_MODEL=./models/piper/fr_FR-upmc-medium.onnx'],
      },
    },
    {
      id: 'espeak-local',
      name: 'eSpeak-NG Open-Source Local',
      capability: 'audio',
      license: 'open-source',
      available: Boolean(rt.espeakBin),
      reason: rt.espeakBin
        ? `Actif (${rt.espeakBin})`
        : 'Optionnel — non installé sur le système',
      envOrBinary: 'ESPEAK_BIN (auto-détecté)',
      isDefault: !piperModelReady && Boolean(rt.espeakBin),
      installGuide: {
        summary: 'Synthétiseur vocal léger open-source hors-ligne multi-langues.',
        commands: ['sudo apt-get update && sudo apt-get install -y espeak-ng'],
        envVars: ['ESPEAK_BIN=/usr/bin/espeak-ng'],
      },
    },
    {
      id: 'gemini-tts',
      name: 'Gemini 3.8 TTS (Voix & Dialogues WAV)',
      capability: 'audio',
      license: 'free-tier',
      available: geminiReady,
      reason: geminiReady
        ? 'GEMINI_API_KEY optionnelle active'
        : 'Optionnel — non configuré (bascule vers TTS gratuit sans clé)',
      envOrBinary: 'GEMINI_API_KEY (optionnel)',
      isDefault: geminiReady && !piperModelReady,
      installGuide: {
        summary: 'Synthèse WAV 24 kHz mono ou dialogue à 2 locuteurs.',
        commands: ['# Optionnel : ajoutez GEMINI_API_KEY dans Settings > Secrets'],
        envVars: ['GEMINI_API_KEY=...'],
      },
    },
    {
      id: 'gtts-free',
      name: 'TTS Web Gratuit + Normalisation WAV FFmpeg',
      capability: 'audio',
      license: 'free-tier',
      available: Boolean(rt.ffmpegBin),
      reason: 'Actif par défaut sans aucune clé API',
      envOrBinary: 'Aucune configuration requise',
      isDefault: !piperModelReady && !rt.espeakBin && !geminiReady,
      installGuide: {
        summary: 'Solution de repli sans clé convertissant automatiquement la parole en WAV 24 kHz.',
        commands: ['# Aucune installation requise — actif automatiquement'],
        envVars: [],
      },
    },
    {
      id: 'ffmpeg-motion',
      name: 'FFmpeg Motion Engine (H.264 / Ken Burns / Pan)',
      capability: 'video',
      license: 'local-engine',
      available: Boolean(rt.ffmpegBin),
      reason: rt.ffmpegBin
        ? `Actif (${rt.ffmpegBin}) — aucune API vidéo payante`
        : 'FFmpeg absent du PATH',
      envOrBinary: '/usr/bin/ffmpeg',
      isDefault: true,
      installGuide: {
        summary: 'Moteur vidéo local open-source (libx264, zoompan, aac) déjà installé.',
        commands: ['sudo apt-get update && sudo apt-get install -y ffmpeg'],
        envVars: [],
      },
    },
    {
      id: 'comfyui-video',
      name: 'ComfyUI Video Open-Source (Wan2.1 / AnimateDiff)',
      capability: 'video',
      license: 'open-source',
      available: Boolean(rt.comfyUrl),
      reason: rt.comfyUrl
        ? `Connecté à ${rt.comfyUrl}`
        : 'Optionnel — non détecté (FFmpeg Motion Engine actif)',
      envOrBinary: 'COMFYUI_URL (optionnel)',
      isDefault: false,
      installGuide: {
        summary: 'Génération vidéo par diffusion open-source en local via ComfyUI.',
        commands: [
          'cd ComfyUI/custom_nodes',
          'git clone https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git',
        ],
        envVars: ['COMFYUI_URL=http://127.0.0.1:8188'],
      },
    },
    {
      id: 'ffmpeg-composer',
      name: 'FFmpeg Composer (Assemblage xfade & Export MP4)',
      capability: 'assembly',
      license: 'local-engine',
      available: Boolean(rt.ffmpegBin),
      reason: rt.ffmpegBin ? 'Actif pour assemblage et mastering MP4' : 'FFmpeg requis',
      envOrBinary: '/usr/bin/ffmpeg',
      isDefault: true,
      installGuide: {
        summary: 'Assemblage multi-scènes (xfade, acrossfade) et mastering MP4 faststart.',
        commands: ['sudo apt-get update && sudo apt-get install -y ffmpeg'],
        envVars: [],
      },
    },
  ];
}

function normalizeScenarioPayload(raw: Partial<ScenarioResult>, fallbackPrompt: string): ScenarioResult {
  const validMotions: MotionPreset[] = [
    'ken_burns_in',
    'ken_burns_out',
    'pan_left',
    'pan_right',
    'tilt_up',
    'static_hold',
  ];
  const scenes: ScenarioScene[] = Array.isArray(raw.scenes)
    ? raw.scenes.map((s, idx) => ({
        sceneNumber: Number(s.sceneNumber) || idx + 1,
        title: s.title || `Scène ${idx + 1}`,
        location: s.location || 'Extérieur',
        timeOfDay: s.timeOfDay || 'Jour',
        visualPrompt:
          s.visualPrompt || `${fallbackPrompt}, cinematic scene ${idx + 1}, 35mm film`,
        cameraMovement: validMotions.includes(s.cameraMovement)
          ? s.cameraMovement
          : validMotions[idx % validMotions.length],
        narrationOrDialogue: s.narrationOrDialogue || fallbackPrompt,
        speaker: s.speaker || 'Narrateur',
        durationSec: Math.max(4, Math.min(18, Math.round(Number(s.durationSec) || 6))),
        characterNames: Array.isArray(s.characterNames) ? s.characterNames : [],
      }))
    : [];

  return {
    title: raw.title || 'Production HAROU',
    logline: raw.logline || fallbackPrompt,
    genre: raw.genre || 'Cinéma',
    tone: raw.tone || 'Cinématique',
    visualStyle: raw.visualStyle || 'Cinéma réaliste 35mm',
    scenes,
  };
}

function normalizeCharacterPayload(
  raw: Partial<CharacterResult>,
  fallbackName: string,
  concept: string
): CharacterResult {
  const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] as const;
  const voice = allowedVoices.includes(raw.recommendedVoice as (typeof allowedVoices)[number])
    ? (raw.recommendedVoice as (typeof allowedVoices)[number])
    : 'Kore';

  return {
    name: raw.name || fallbackName || 'Personnage',
    role: raw.role || 'Protagoniste',
    age: raw.age || '30 ans',
    physicalDescription: raw.physicalDescription || concept,
    wardrobe: raw.wardrobe || 'Tenue cinématographique sobre',
    personality: raw.personality || 'Déterminé et attentif',
    voiceStyle: raw.voiceStyle || 'Voix posée et expressive',
    recommendedVoice: voice,
    visualPromptAnchor:
      raw.visualPromptAnchor ||
      `Cinematic portrait of ${raw.name || fallbackName}, ${concept}, natural rim lighting`,
  };
}

async function generateWithPollinationsText(systemPrompt: string, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Pollinations Text HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Réponse vide de Pollinations Text');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateScenarioWithOllama(
  baseUrl: string,
  params: {
    prompt: string;
    genre?: string;
    tone?: string;
    visualStyle?: string;
    sceneCount?: number;
    language?: string;
  }
): Promise<ScenarioResult> {
  const model = process.env.OLLAMA_MODEL?.trim() || 'llama3.2';
  const count = Math.max(2, Math.min(8, params.sceneCount || 4));
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      format: 'json',
      stream: false,
      messages: [
        {
          role: 'system',
          content: `Return valid JSON only with keys: title, logline, genre, tone, visualStyle, scenes (array of ${count} objects with sceneNumber, title, location, timeOfDay, visualPrompt, cameraMovement, narrationOrDialogue, speaker, durationSec, characterNames). Language: ${params.language || 'fr'}. visualPrompt must be in English. cameraMovement must be one of ken_burns_in, ken_burns_out, pan_left, pan_right, tilt_up, static_hold.`,
        },
        {
          role: 'user',
          content: `Prompt: ${params.prompt}. Genre: ${params.genre || 'cinéma'}. Tone: ${params.tone || 'dramatique'}. Style: ${params.visualStyle || 'cinématique'}.`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama error (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const parsed = JSON.parse(data.message?.content || '{}') as Partial<ScenarioResult>;
  return normalizeScenarioPayload(parsed, params.prompt);
}

export async function runScenarioProvider(params: {
  provider?: string;
  prompt: string;
  genre?: string;
  tone?: string;
  visualStyle?: string;
  sceneCount?: number;
  language?: string;
}): Promise<{ provider: string; result: ScenarioResult }> {
  const rt = await detectRuntime();
  const count = Math.max(2, Math.min(8, params.sceneCount || 4));
  const requested = params.provider && params.provider !== 'auto' ? params.provider : null;

  const order = requested
    ? [requested, 'ollama-local', 'gemini-free', 'huggingface-free', 'pollinations-text']
    : ['ollama-local', 'gemini-free', 'huggingface-free', 'pollinations-text'];

  const tried = new Set<string>();
  const errors: string[] = [];

  for (const candidate of order) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      if (candidate === 'ollama-local') {
        if (!rt.ollamaUrl) continue;
        const result = await generateScenarioWithOllama(rt.ollamaUrl, params);
        return { provider: 'ollama-local', result };
      }

      if (candidate === 'gemini-free') {
        if (!hasValidEnv('GEMINI_API_KEY', 'MY_GEMINI_API_KEY')) continue;
        const result = await generateScenarioWithGemini(params);
        return { provider: 'gemini-free', result: normalizeScenarioPayload(result, params.prompt) };
      }

      if (candidate === 'huggingface-free') {
        const token = process.env.HF_TOKEN?.trim();
        if (!token) continue;
        const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'Qwen/Qwen2.5-72B-Instruct',
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: `Return valid JSON only with keys: title, logline, genre, tone, visualStyle, scenes (array of ${count} objects with sceneNumber, title, location, timeOfDay, visualPrompt, cameraMovement, narrationOrDialogue, speaker, durationSec, characterNames). Language: ${params.language || 'fr'}. visualPrompt must be in English.`,
              },
              { role: 'user', content: params.prompt },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HF ${res.status}`);
        const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}') as Partial<ScenarioResult>;
        return { provider: 'huggingface-free', result: normalizeScenarioPayload(parsed, params.prompt) };
      }

      if (candidate === 'pollinations-text') {
        const sys = `You are a cinema screenwriter. Return valid JSON ONLY with keys: title, logline, genre, tone, visualStyle, scenes (exact array of ${count} objects with keys: sceneNumber (int), title, location, timeOfDay, visualPrompt (detailed English prompt for image generation), cameraMovement (one of: ken_burns_in, ken_burns_out, pan_left, pan_right, tilt_up, static_hold), narrationOrDialogue, speaker, durationSec (int 5-10), characterNames (string array)). Write title, logline, narrationOrDialogue in language "${params.language || 'fr'}".`;
        const usr = `Concept: ${params.prompt}. Genre: ${params.genre || 'cinéma'}. Style: ${params.visualStyle || 'cinématique'}.`;
        const jsonStr = await generateWithPollinationsText(sys, usr);
        const parsed = JSON.parse(jsonStr) as Partial<ScenarioResult>;
        return { provider: 'pollinations-text', result: normalizeScenarioPayload(parsed, params.prompt) };
      }
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Aucun moteur de scénarisation disponible (${errors.join(' | ')})`);
}

export async function runCharacterProvider(params: {
  provider?: string;
  name?: string;
  concept: string;
  role?: string;
  visualStyle?: string;
  language?: string;
}): Promise<{ provider: string; result: CharacterResult }> {
  const rt = await detectRuntime();
  const requested = params.provider && params.provider !== 'auto' ? params.provider : null;
  const order = requested
    ? [requested, 'ollama-local', 'gemini-free', 'pollinations-text']
    : ['ollama-local', 'gemini-free', 'pollinations-text'];

  const tried = new Set<string>();
  const errors: string[] = [];

  for (const candidate of order) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      if (candidate === 'ollama-local') {
        if (!rt.ollamaUrl) continue;
        const res = await fetch(`${rt.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL?.trim() || 'llama3.2',
            format: 'json',
            stream: false,
            messages: [
              {
                role: 'system',
                content:
                  'Return valid JSON with: name, role, age, physicalDescription, wardrobe, personality, voiceStyle, recommendedVoice (one of Puck, Charon, Kore, Fenrir, Zephyr), visualPromptAnchor (English detailed portrait prompt).',
              },
              { role: 'user', content: `${params.name ? `Name: ${params.name}. ` : ''}${params.concept}` },
            ],
          }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        const data = (await res.json()) as { message?: { content?: string } };
        const parsed = JSON.parse(data.message?.content || '{}') as Partial<CharacterResult>;
        return {
          provider: 'ollama-local',
          result: normalizeCharacterPayload(parsed, params.name || 'Personnage', params.concept),
        };
      }

      if (candidate === 'gemini-free') {
        if (!hasValidEnv('GEMINI_API_KEY', 'MY_GEMINI_API_KEY')) continue;
        const result = await generateCharacterWithGemini(params);
        return {
          provider: 'gemini-free',
          result: normalizeCharacterPayload(result, params.name || 'Personnage', params.concept),
        };
      }

      if (candidate === 'pollinations-text') {
        const sys = `Return valid JSON ONLY with keys: name, role, age, physicalDescription, wardrobe, personality, voiceStyle, recommendedVoice (exactly one of: Puck, Charon, Kore, Fenrir, Zephyr), visualPromptAnchor (detailed English portrait prompt for image generation). Write descriptions in "${params.language || 'fr'}".`;
        const usr = `${params.name ? `Name: ${params.name}. ` : ''}${params.role ? `Role: ${params.role}. ` : ''}Concept: ${params.concept}`;
        const jsonStr = await generateWithPollinationsText(sys, usr);
        const parsed = JSON.parse(jsonStr) as Partial<CharacterResult>;
        return {
          provider: 'pollinations-text',
          result: normalizeCharacterPayload(parsed, params.name || 'Personnage', params.concept),
        };
      }
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Aucun moteur de création de personnage disponible (${errors.join(' | ')})`);
}

async function generateWithComfyUI(
  comfyUrl: string,
  prompt: string,
  width: number,
  height: number,
  seed: number,
  outputPath: string
): Promise<void> {
  const ckpt = process.env.COMFYUI_CHECKPOINT?.trim() || 'v1-5-pruned-emaonly.safetensors';
  const workflow = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 20,
        cfg: 7.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, lowres, watermark, text', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'harou_gen', images: ['8', 0] } },
  };

  const queueRes = await fetch(`${comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!queueRes.ok) {
    throw new Error(`ComfyUI /prompt HTTP ${queueRes.status}`);
  }
  const { prompt_id } = (await queueRes.json()) as { prompt_id: string };

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const histRes = await fetch(`${comfyUrl}/history/${prompt_id}`);
    if (!histRes.ok) continue;
    const hist = (await histRes.json()) as Record<
      string,
      { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }
    >;
    const entry = hist[prompt_id];
    const imageMeta = entry?.outputs?.['9']?.images?.[0];
    if (imageMeta) {
      const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(imageMeta.filename)}&subfolder=${encodeURIComponent(imageMeta.subfolder || '')}&type=${encodeURIComponent(imageMeta.type || 'output')}`;
      const imgRes = await fetch(viewUrl);
      if (!imgRes.ok) throw new Error(`ComfyUI /view HTTP ${imgRes.status}`);
      await fs.promises.writeFile(outputPath, Buffer.from(await imgRes.arrayBuffer()));
      return;
    }
  }
  throw new Error('Timeout ComfyUI');
}

export async function runImageProvider(params: {
  provider?: string;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  outputPath: string;
}): Promise<{ provider: string; mimeType: string; width: number; height: number }> {
  const rt = await detectRuntime();
  const width = Math.max(256, Math.min(1920, params.width || 1280));
  const height = Math.max(256, Math.min(1920, params.height || 720));
  const seed = params.seed ?? Math.floor(Math.random() * 999999);

  const requested = params.provider && params.provider !== 'auto' ? params.provider : null;
  const order = requested
    ? [requested, 'comfyui-local', 'sd-webui-local', 'huggingface-flux', 'pollinations-flux']
    : ['comfyui-local', 'sd-webui-local', 'huggingface-flux', 'pollinations-flux'];

  const tried = new Set<string>();
  const errors: string[] = [];

  for (const candidate of order) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      if (candidate === 'comfyui-local') {
        if (!rt.comfyUrl) continue;
        await generateWithComfyUI(rt.comfyUrl, params.prompt, width, height, seed, params.outputPath);
        return { provider: 'comfyui-local', mimeType: 'image/png', width, height };
      }

      if (candidate === 'sd-webui-local') {
        if (!rt.sdWebuiUrl) continue;
        const res = await fetch(`${rt.sdWebuiUrl}/sdapi/v1/txt2img`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: params.prompt, width, height, steps: 20, seed }),
        });
        if (!res.ok) throw new Error(`SD WebUI ${res.status}`);
        const data = (await res.json()) as { images?: string[] };
        const b64 = data.images?.[0];
        if (!b64) throw new Error('Image vide depuis SD WebUI');
        await fs.promises.writeFile(params.outputPath, Buffer.from(b64, 'base64'));
        return { provider: 'sd-webui-local', mimeType: 'image/png', width, height };
      }

      if (candidate === 'huggingface-flux') {
        const token = process.env.HF_TOKEN?.trim();
        if (!token) continue;
        const res = await fetch(
          'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inputs: params.prompt,
              parameters: { width, height },
            }),
          }
        );
        if (!res.ok) throw new Error(`HF FLUX ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(params.outputPath, buf);
        return {
          provider: 'huggingface-flux',
          mimeType: res.headers.get('content-type') || 'image/jpeg',
          width,
          height,
        };
      }

      if (candidate === 'pollinations-flux') {
        const encodedPrompt = encodeURIComponent(params.prompt);
        for (const model of ['flux', 'turbo']) {
          const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);
          try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) {
              errors.push(`pollinations-${model}: HTTP ${res.status}`);
              continue;
            }
            const contentType = res.headers.get('content-type') || 'image/jpeg';
            if (!contentType.startsWith('image/')) continue;
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length < 1500) continue;
            await fs.promises.writeFile(params.outputPath, buffer);
            return {
              provider: `pollinations-${model}`,
              mimeType: contentType,
              width,
              height,
            };
          } finally {
            clearTimeout(timeout);
          }
        }
      }
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Échec de génération d’image (${errors.join(' | ')})`);
}

function splitTextForTts(text: string, maxLen = 175): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  const sentences = cleaned.split(/(?<=[.!?;:])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence;
      } else {
        const words = sentence.split(' ');
        current = '';
        for (const w of words) {
          if ((current + ' ' + w).trim().length <= maxLen) {
            current = (current + ' ' + w).trim();
          } else {
            if (current) chunks.push(current);
            current = w;
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function runPiperStdin(piperBin: string, modelPath: string, text: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(piperBin, ['--model', modelPath, '--output_file', outputPath]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Piper exited ${code}: ${stderr.slice(-300)}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

async function generateWithFreeWebTts(text: string, lang: string, outputPath: string): Promise<void> {
  const chunks = splitTextForTts(text, 175);
  if (chunks.length === 0) throw new Error('Texte vide pour la synthèse vocale.');

  const tmpDir = path.join(os.tmpdir(), `harou_tts_${crypto.randomUUID().slice(0, 8)}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const segmentPaths: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const segPath = path.join(tmpDir, `seg_${i}.mp3`);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunks[i])}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) {
        throw new Error(`Free Web TTS HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) {
        throw new Error('Segment audio vide reçu');
      }
      await fs.promises.writeFile(segPath, buf);
      segmentPaths.push(segPath);
    }

    await concatAudioFilesToWav(segmentPaths, outputPath);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function runAudioProvider(params: {
  provider?: string;
  text: string;
  voiceName?: string;
  style?: string;
  language?: string;
  mode?: 'single' | 'dialogue';
  speakers?: Array<{ speaker: string; voiceName: string; style?: string; text: string }>;
  outputPath: string;
}): Promise<{ provider: string; mimeType: string }> {
  const rt = await detectRuntime();
  const piperModel = process.env.PIPER_MODEL?.trim();
  const piperReady = Boolean(rt.piperBin && piperModel && fs.existsSync(piperModel));

  const requested = params.provider && params.provider !== 'auto' ? params.provider : null;
  const order = requested
    ? [requested, 'piper-local', 'espeak-local', 'gemini-tts', 'gtts-free']
    : ['piper-local', 'espeak-local', 'gemini-tts', 'gtts-free'];

  const tried = new Set<string>();
  const errors: string[] = [];
  const fullText =
    params.mode === 'dialogue' && params.speakers?.length
      ? params.speakers.map((s) => s.text).join('. ')
      : params.text;

  for (const candidate of order) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      if (candidate === 'piper-local') {
        if (!piperReady || !rt.piperBin || !piperModel) continue;
        await runPiperStdin(rt.piperBin, piperModel, fullText, params.outputPath);
        return { provider: 'piper-local', mimeType: 'audio/wav' };
      }

      if (candidate === 'espeak-local') {
        if (!rt.espeakBin) continue;
        const langFlag = (params.language || 'fr').slice(0, 2);
        await execFileAsync(rt.espeakBin, ['-v', langFlag, '-w', params.outputPath, fullText]);
        return { provider: 'espeak-local', mimeType: 'audio/wav' };
      }

      if (candidate === 'gemini-tts') {
        if (!hasValidEnv('GEMINI_API_KEY', 'MY_GEMINI_API_KEY')) continue;
        const wavBuffer = await generateSpeechWithGemini({
          text: params.text,
          voiceName: params.voiceName,
          style: params.style,
          mode: params.mode,
          speakers: params.speakers,
        });
        await fs.promises.writeFile(params.outputPath, wavBuffer);
        return { provider: 'gemini-tts', mimeType: 'audio/wav' };
      }

      if (candidate === 'gtts-free') {
        await generateWithFreeWebTts(fullText, params.language || 'fr', params.outputPath);
        return { provider: 'gtts-free', mimeType: 'audio/wav' };
      }
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Aucun moteur vocal disponible (${errors.join(' | ')})`);
}

export function isValidMotionPreset(val: string | undefined): val is MotionPreset {
  return (
    val === 'ken_burns_in' ||
    val === 'ken_burns_out' ||
    val === 'pan_left' ||
    val === 'pan_right' ||
    val === 'tilt_up' ||
    val === 'static_hold'
  );
}
