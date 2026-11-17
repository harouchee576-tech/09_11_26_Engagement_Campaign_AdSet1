/**
 * HAROU GENERATOR — Client SDK serveur officiel pour HAROU AI
 * Stockez HAROU_GENERATOR_API_KEY exclusivement côté serveur (process.env).
 */

export interface HarouClientConfig {
  baseUrl?: string;
  apiKey?: string;
}

export class HarouGeneratorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private verifiedEndpoints: Set<string> | null = null;

  constructor(config: HarouClientConfig = {}) {
    const url =
      config.baseUrl ||
      process.env.HAROU_GENERATOR_URL ||
      'https://ais-dev-gepkvblfzq7ithtnkhgyog-11436453178.europe-west2.run.app/api/v1';
    const key = config.apiKey || process.env.HAROU_GENERATOR_API_KEY || '';
    if (!key) {
      throw new Error(
        'HAROU_GENERATOR_API_KEY manquante côté serveur. Ne jamais exposer la clé côté navigateur.'
      );
    }
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = key;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers || {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.message || data.error || `HAROU GENERATOR HTTP ${res.status}`);
    }
    return data;
  }

  /** Vérifie les endpoints réellement exposés par le moteur avant envoi */
  async verifyEndpoints(): Promise<{
    engine: string;
    personalApiBaseUrl: string;
    endpoints: Array<{ method: string; path: string; description: string }>;
  }> {
    const info = await this.request<{
      engine: string;
      personalApiBaseUrl: string;
      endpoints: Array<{ method: string; path: string; description: string }>;
    }>('/info');
    this.verifiedEndpoints = new Set(
      info.endpoints.map((e) => `${e.method.toUpperCase()} ${e.path.replace(/^\/api\/v1/, '')}`)
    );
    return info;
  }

  private async assertEndpoint(method: string, relativePath: string): Promise<void> {
    if (!this.verifiedEndpoints) {
      await this.verifyEndpoints();
    }
    const key = `${method.toUpperCase()} ${relativePath}`;
    if (!this.verifiedEndpoints?.has(key)) {
      throw new Error(`Endpoint non disponible sur ce moteur HAROU GENERATOR : ${key}`);
    }
  }

  async submitScenario(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/scenarios');
    return this.request('/scenarios', { method: 'POST', body: JSON.stringify(payload) });
  }

  async generateScenario(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/scenarios/generate');
    return this.request('/scenarios/generate', { method: 'POST', body: JSON.stringify(payload) });
  }

  async submitCharacter(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/characters');
    return this.request('/characters', { method: 'POST', body: JSON.stringify(payload) });
  }

  async createCharacter(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/characters/create');
    return this.request('/characters/create', { method: 'POST', body: JSON.stringify(payload) });
  }

  async importImage(payload: { base64?: string; sourceUrl?: string; mimeType?: string; prompt?: string; projectId?: string }) {
    await this.assertEndpoint('POST', '/images/import');
    return this.request('/images/import', { method: 'POST', body: JSON.stringify(payload) });
  }

  async generateImage(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/images/generate');
    return this.request('/images/generate', { method: 'POST', body: JSON.stringify(payload) });
  }

  async generateAudio(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/audio/generate');
    return this.request('/audio/generate', { method: 'POST', body: JSON.stringify(payload) });
  }

  async generateVideo(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/videos/generate');
    return this.request('/videos/generate', { method: 'POST', body: JSON.stringify(payload) });
  }

  async createAssembly(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/assemblies/create');
    return this.request('/assemblies/create', { method: 'POST', body: JSON.stringify(payload) });
  }

  async exportMp4(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/exports/mp4');
    return this.request('/exports/mp4', { method: 'POST', body: JSON.stringify(payload) });
  }

  async produceFilm(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/pipeline/produce');
    return this.request('/pipeline/produce', { method: 'POST', body: JSON.stringify(payload) });
  }

  async getEngines() {
    await this.assertEndpoint('GET', '/engines');
    return this.request('/engines');
  }

  async getProjectMemory(projectId: string) {
    return this.request(`/memory/${projectId}`);
  }

  async dispatch(payload: Record<string, unknown>) {
    await this.assertEndpoint('POST', '/dispatch');
    return this.request('/dispatch', { method: 'POST', body: JSON.stringify(payload) });
  }

  async getCreator() {
    return this.request('/creator');
  }

  async askAboutCreator(question: string) {
    return this.request('/creator/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  }

  async getJob(jobId: string) {
    return this.request<{ job: { id: string; status: string; progress: number; output?: Record<string, unknown>; error?: string } }>(`/jobs/${jobId}`);
  }

  async getProject(projectId: string) {
    return this.request(`/projects/${projectId}`);
  }

  async waitForJob(jobId: string, intervalMs = 1500, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { job } = await this.getJob(jobId);
      if (job.status === 'completed') return job;
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error || `Tâche ${jobId} terminée avec statut ${job.status}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Délai d’attente dépassé pour la tâche ${jobId}`);
  }

  /** Télécharge un média ou une vidéo MP4 côté serveur avec authentification Bearer */
  async fetchMediaBuffer(mediaUrlOrPath: string): Promise<{ buffer: Buffer; contentType: string }> {
    const targetUrl = mediaUrlOrPath.startsWith('http')
      ? mediaUrlOrPath
      : `${this.baseUrl.replace(/\/api\/v1$/, '')}${mediaUrlOrPath}`;
    const res = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Téléchargement média échoué (HTTP ${res.status})`);
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }
}
