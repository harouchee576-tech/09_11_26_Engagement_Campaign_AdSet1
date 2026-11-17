import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureRuntimeDirectories } from '../config.ts';
import { db } from '../store.ts';
import type { CharacterRecord, ScenarioRecord } from '../types.ts';

export type HarouEngineId =
  | 'harou-devin-2.0'
  | 'harou-ailleurs-4.6'
  | 'harou-tic-tac-3.7'
  | 'harou-unix-5.8'
  | 'harou-generator-2.0';

export interface TicTacMemoryContext {
  projectId: string;
  visualStyleLock: string;
  continuityNotes: string[];
  characterAnchors: Array<{
    characterId: string;
    name: string;
    visualPromptAnchor: string;
    recommendedVoice: string;
    voiceStyle: string;
  }>;
  lastScenarioId?: string;
  updatedAt: string;
}

const MEMORY_FILE = path.join(DATA_DIR, 'tic-tac-memory.json');
let memoryCache: Record<string, TicTacMemoryContext> | null = null;

function loadMemoryStore(): Record<string, TicTacMemoryContext> {
  if (memoryCache) return memoryCache;
  ensureRuntimeDirectories();
  if (!fs.existsSync(MEMORY_FILE)) {
    memoryCache = {};
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryCache, null, 2));
    return memoryCache;
  }
  try {
    memoryCache = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as Record<
      string,
      TicTacMemoryContext
    >;
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

function saveMemoryStore(store: Record<string, TicTacMemoryContext>): void {
  ensureRuntimeDirectories();
  memoryCache = store;
  const tmp = `${MEMORY_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, MEMORY_FILE);
}

/**
 * HAROU TIC-TAC 3.7 : Mémoire partagée & coordination inter-moteurs
 */
export const HarouTicTacMemory = {
  getContext(projectId?: string): TicTacMemoryContext | undefined {
    if (!projectId) return undefined;
    const store = loadMemoryStore();
    return store[projectId];
  },

  upsertProjectStyle(projectId: string | undefined, visualStyle?: string, note?: string): void {
    if (!projectId) return;
    const store = loadMemoryStore();
    const existing = store[projectId] || {
      projectId,
      visualStyleLock: visualStyle || 'Cinéma réaliste 35mm',
      continuityNotes: [],
      characterAnchors: [],
      updatedAt: new Date().toISOString(),
    };
    if (visualStyle) existing.visualStyleLock = visualStyle;
    if (note && !existing.continuityNotes.includes(note)) {
      existing.continuityNotes.push(note);
    }
    existing.updatedAt = new Date().toISOString();
    store[projectId] = existing;
    saveMemoryStore(store);
  },

  registerCharacter(projectId: string | undefined, char: CharacterRecord): void {
    if (!projectId) return;
    const store = loadMemoryStore();
    const existing = store[projectId] || {
      projectId,
      visualStyleLock: 'Cinéma réaliste 35mm',
      continuityNotes: [],
      characterAnchors: [],
      updatedAt: new Date().toISOString(),
    };
    const filtered = existing.characterAnchors.filter((c) => c.characterId !== char.id);
    filtered.push({
      characterId: char.id,
      name: char.name,
      visualPromptAnchor: char.visualPromptAnchor,
      recommendedVoice: char.recommendedVoice,
      voiceStyle: char.voiceStyle,
    });
    existing.characterAnchors = filtered;
    existing.updatedAt = new Date().toISOString();
    store[projectId] = existing;
    saveMemoryStore(store);
  },

  registerScenario(projectId: string | undefined, scenario: ScenarioRecord): void {
    if (!projectId) return;
    const store = loadMemoryStore();
    const existing = store[projectId] || {
      projectId,
      visualStyleLock: scenario.visualStyle,
      continuityNotes: [],
      characterAnchors: [],
      updatedAt: new Date().toISOString(),
    };
    existing.lastScenarioId = scenario.id;
    existing.visualStyleLock = scenario.visualStyle || existing.visualStyleLock;
    existing.continuityNotes.push(`${scenario.title}: ${scenario.logline}`);
    existing.updatedAt = new Date().toISOString();
    store[projectId] = existing;
    saveMemoryStore(store);
  },

  /** Enrichit un prompt visuel pour HAROU AILLEURS 4.6 avec la mémoire de cohérence */
  enrichVisualPrompt(prompt: string, projectId?: string): string {
    if (!projectId) return prompt;
    const ctx = this.getContext(projectId);
    const project = db.getProject(projectId);
    const allChars = db.getAll().characters;
    const projectChars = project
      ? allChars.filter((c) => project.characterIds.includes(c.id))
      : [];

    const matchedAnchors: string[] = [];
    const lowerPrompt = prompt.toLowerCase();

    for (const c of projectChars) {
      if (lowerPrompt.includes(c.name.toLowerCase())) {
        matchedAnchors.push(c.visualPromptAnchor);
      }
    }
    if (ctx) {
      for (const anchor of ctx.characterAnchors) {
        if (
          lowerPrompt.includes(anchor.name.toLowerCase()) &&
          !matchedAnchors.includes(anchor.visualPromptAnchor)
        ) {
          matchedAnchors.push(anchor.visualPromptAnchor);
        }
      }
    }

    const parts = [prompt];
    if (matchedAnchors.length > 0) {
      parts.push(`character consistency: ${matchedAnchors.join(', ')}`);
    }
    if (ctx?.visualStyleLock && !lowerPrompt.includes(ctx.visualStyleLock.toLowerCase())) {
      parts.push(ctx.visualStyleLock);
    }
    return parts.join(', ');
  },

  /** Enrichit un prompt de scénario pour HAROU DEVIN 2.0 avec les personnages existants */
  buildScenarioContextHint(projectId?: string): string {
    if (!projectId) return '';
    const ctx = this.getContext(projectId);
    if (!ctx || ctx.characterAnchors.length === 0) return '';
    const charSummary = ctx.characterAnchors
      .map((c) => `${c.name} (${c.visualPromptAnchor})`)
      .join('; ');
    return `Personnages existants à réutiliser avec cohérence : ${charSummary}. Style verrouillé : ${ctx.visualStyleLock}.`;
  },
};

export type DispatchTaskKind =
  | 'scenario'
  | 'character'
  | 'image'
  | 'audio'
  | 'video'
  | 'assembly'
  | 'export'
  | 'film';

export function resolveEngineForTask(kind: DispatchTaskKind): {
  engineId: HarouEngineId;
  engineName: string;
  collaborators: HarouEngineId[];
} {
  switch (kind) {
    case 'scenario':
      return {
        engineId: 'harou-devin-2.0',
        engineName: 'HAROU DEVIN 2.0',
        collaborators: ['harou-tic-tac-3.7'],
      };
    case 'image':
      return {
        engineId: 'harou-ailleurs-4.6',
        engineName: 'HAROU AILLEURS 4.6',
        collaborators: ['harou-tic-tac-3.7'],
      };
    case 'character':
    case 'audio':
      return {
        engineId: 'harou-tic-tac-3.7',
        engineName: 'HAROU TIC-TAC 3.7',
        collaborators: ['harou-ailleurs-4.6'],
      };
    case 'video':
    case 'assembly':
    case 'export':
      return {
        engineId: 'harou-unix-5.8',
        engineName: 'HAROU UNIX 5.8',
        collaborators: ['harou-tic-tac-3.7', 'harou-ailleurs-4.6'],
      };
    case 'film':
    default:
      return {
        engineId: 'harou-generator-2.0',
        engineName: 'HAROU GENERATOR 2.0',
        collaborators: [
          'harou-devin-2.0',
          'harou-tic-tac-3.7',
          'harou-ailleurs-4.6',
          'harou-unix-5.8',
        ],
      };
  }
}

export function classifyIntentToTask(input: {
  task?: string;
  prompt?: string;
  sequenceAssetIds?: string[];
  sourceAssetId?: string;
  imageAssetId?: string;
}): DispatchTaskKind {
  const t = (input.task || '').toLowerCase().trim();
  if (t === 'scenario' || t === 'scénario') return 'scenario';
  if (t === 'character' || t === 'personnage') return 'character';
  if (t === 'image') return 'image';
  if (t === 'audio' || t === 'voice' || t === 'voix' || t === 'dialogue') return 'audio';
  if (t === 'video' || t === 'sequence' || t === 'séquence') return 'video';
  if (t === 'assembly' || t === 'assemblage') return 'assembly';
  if (t === 'export' || t === 'mp4') return 'export';
  if (t === 'film' || t === 'pipeline' || t === 'produce') return 'film';

  if (input.sourceAssetId) return 'export';
  if (input.sequenceAssetIds && input.sequenceAssetIds.length > 0) return 'assembly';
  if (input.imageAssetId) return 'video';

  const p = (input.prompt || '').toLowerCase();
  if (/\b(film|court[- ]métrage|clip complet|produis|produire|vidéo complète)\b/.test(p)) {
    return 'film';
  }
  if (/\b(scénario|script|histoire|synopsis|scènes)\b/.test(p)) return 'scenario';
  if (/\b(personnage|héros|protagoniste|avatar|portrait)\b/.test(p)) return 'character';
  if (/\b(voix|dialogue|audio|narration|parle)\b/.test(p)) return 'audio';
  if (/\b(image|illustration|photo|visuel|affiche)\b/.test(p)) return 'image';
  if (/\b(séquence|animer|vidéo)\b/.test(p)) return 'video';
  return 'film';
}
