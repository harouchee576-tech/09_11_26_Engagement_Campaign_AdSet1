import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureRuntimeDirectories } from './config.ts';
import type {
  CharacterRecord,
  JobRecord,
  MediaAssetRecord,
  ProductionProject,
  ScenarioRecord,
} from './types.ts';

interface DatabaseState {
  projects: ProductionProject[];
  scenarios: ScenarioRecord[];
  characters: CharacterRecord[];
  assets: MediaAssetRecord[];
  jobs: JobRecord[];
}

const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_STATE: DatabaseState = {
  projects: [],
  scenarios: [],
  characters: [],
  assets: [],
  jobs: [],
};

let stateCache: DatabaseState | null = null;
let writeChain: Promise<void> = Promise.resolve();

function loadDb(): DatabaseState {
  if (stateCache) return stateCache;
  ensureRuntimeDirectories();
  if (!fs.existsSync(DB_FILE)) {
    stateCache = structuredClone(EMPTY_STATE);
    fs.writeFileSync(DB_FILE, JSON.stringify(stateCache, null, 2));
    return stateCache;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    stateCache = {
      projects: parsed.projects ?? [],
      scenarios: parsed.scenarios ?? [],
      characters: parsed.characters ?? [],
      assets: parsed.assets ?? [],
      jobs: parsed.jobs ?? [],
    };
  } catch {
    stateCache = structuredClone(EMPTY_STATE);
  }
  return stateCache;
}

async function persistDb(next: DatabaseState): Promise<void> {
  stateCache = next;
  writeChain = writeChain.then(async () => {
    ensureRuntimeDirectories();
    const tmp = `${DB_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writeChain;
}

export const db = {
  getAll(): DatabaseState {
    return loadDb();
  },

  async createProject(project: ProductionProject): Promise<ProductionProject> {
    const current = loadDb();
    current.projects.unshift(project);
    await persistDb(current);
    return project;
  },

  async updateProject(
    id: string,
    updater: (project: ProductionProject) => void
  ): Promise<ProductionProject | undefined> {
    const current = loadDb();
    const target = current.projects.find((p) => p.id === id);
    if (!target) return undefined;
    updater(target);
    target.updatedAt = new Date().toISOString();
    await persistDb(current);
    return target;
  },

  getProject(id: string): ProductionProject | undefined {
    return loadDb().projects.find((p) => p.id === id);
  },

  async addScenario(scenario: ScenarioRecord): Promise<ScenarioRecord> {
    const current = loadDb();
    current.scenarios.unshift(scenario);
    await persistDb(current);
    return scenario;
  },

  getScenario(id: string): ScenarioRecord | undefined {
    return loadDb().scenarios.find((s) => s.id === id);
  },

  async addCharacter(character: CharacterRecord): Promise<CharacterRecord> {
    const current = loadDb();
    current.characters.unshift(character);
    await persistDb(current);
    return character;
  },

  getCharacter(id: string): CharacterRecord | undefined {
    return loadDb().characters.find((c) => c.id === id);
  },

  async addAsset(asset: MediaAssetRecord): Promise<MediaAssetRecord> {
    const current = loadDb();
    current.assets.unshift(asset);
    await persistDb(current);
    return asset;
  },

  getAsset(id: string): MediaAssetRecord | undefined {
    return loadDb().assets.find((a) => a.id === id);
  },

  async addJob(job: JobRecord): Promise<JobRecord> {
    const current = loadDb();
    current.jobs.unshift(job);
    if (current.jobs.length > 250) {
      current.jobs = current.jobs.slice(0, 250);
    }
    await persistDb(current);
    return job;
  },

  async updateJob(id: string, updater: (job: JobRecord) => void): Promise<JobRecord | undefined> {
    const current = loadDb();
    const target = current.jobs.find((j) => j.id === id);
    if (!target) return undefined;
    updater(target);
    await persistDb(current);
    return target;
  },

  getJob(id: string): JobRecord | undefined {
    return loadDb().jobs.find((j) => j.id === id);
  },
};
