import type {
  ApiKeyInfo,
  CharacterRecord,
  EngineInfo,
  EnginesReport,
  HealthReport,
  JobRecord,
  MediaAssetRecord,
  ProductionProject,
  ScenarioRecord,
} from '../types';

let sessionReadyPromise: Promise<void> | null = null;

export async function ensureStudioSession(): Promise<void> {
  if (!sessionReadyPromise) {
    sessionReadyPromise = fetch('/api/studio/session', {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then((res) => {
        if (!res.ok) throw new Error('Impossible d’initialiser la session studio');
      })
      .catch((err) => {
        sessionReadyPromise = null;
        throw err;
      });
  }
  return sessionReadyPromise;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureStudioSession();
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.message || data.error || `Erreur API (${res.status})`);
  }
  return data;
}

export const harouApi = {
  getHealth: () => apiFetch<HealthReport>('/api/v1/health'),
  getInfo: () => apiFetch<EngineInfo>('/api/v1/info'),
  getEngines: () => apiFetch<EnginesReport>('/api/v1/engines'),
  getProjects: () => apiFetch<{ projects: ProductionProject[] }>('/api/v1/projects'),
  getProjectDetail: (id: string) =>
    apiFetch<{
      project: ProductionProject;
      scenario?: ScenarioRecord;
      characters: CharacterRecord[];
      assets: MediaAssetRecord[];
      jobs: JobRecord[];
    }>(`/api/v1/projects/${id}`),
  getJobs: () => apiFetch<{ jobs: JobRecord[] }>('/api/v1/jobs'),
  cancelJob: (id: string) => apiFetch<{ job: JobRecord }>(`/api/v1/jobs/${id}/cancel`, { method: 'POST' }),
  getScenarios: () => apiFetch<{ scenarios: ScenarioRecord[] }>('/api/v1/scenarios'),
  getCharacters: () => apiFetch<{ characters: CharacterRecord[] }>('/api/v1/characters'),
  getImages: () => apiFetch<{ images: MediaAssetRecord[] }>('/api/v1/images'),
  getAudio: () => apiFetch<{ audio: MediaAssetRecord[] }>('/api/v1/audio'),
  getVideos: () => apiFetch<{ sequences: MediaAssetRecord[] }>('/api/v1/videos'),
  getAssemblies: () => apiFetch<{ assemblies: MediaAssetRecord[] }>('/api/v1/assemblies'),
  getExports: () => apiFetch<{ exports: MediaAssetRecord[] }>('/api/v1/exports'),
  getKeys: () => apiFetch<{ keys: ApiKeyInfo[] }>('/api/v1/keys'),
  createKey: (name: string) =>
    apiFetch<{ key: ApiKeyInfo; plaintextKey: string; note: string }>('/api/v1/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeKey: (id: string) =>
    apiFetch<{ revoked: boolean }>(`/api/v1/keys/${id}`, { method: 'DELETE' }),

  producePipeline: (payload: Record<string, unknown>) =>
    apiFetch<{ project: ProductionProject; job: JobRecord }>('/api/v1/pipeline/produce', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateScenario: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/scenarios/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createCharacter: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/characters/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateImage: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/images/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateAudio: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/audio/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateVideo: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/videos/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createAssembly: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/assemblies/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exportMp4: (payload: Record<string, unknown>) =>
    apiFetch<{ job: JobRecord }>('/api/v1/exports/mp4', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 o';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
