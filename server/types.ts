export type JobType =
  | 'scenario'
  | 'character'
  | 'image'
  | 'audio'
  | 'video'
  | 'assembly'
  | 'export'
  | 'pipeline';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type MediaCategory = 'images' | 'audio' | 'sequences' | 'assemblies' | 'exports';

export type MotionPreset =
  | 'ken_burns_in'
  | 'ken_burns_out'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'static_hold';

export type TransitionPreset = 'fade' | 'dissolve' | 'wipeleft' | 'slideleft' | 'cut';

export type ExportProfile = '1080p' | '720p' | 'vertical_9_16' | 'square_1_1';

export interface ScenarioScene {
  sceneNumber: number;
  title: string;
  location: string;
  timeOfDay: string;
  visualPrompt: string;
  cameraMovement: MotionPreset;
  narrationOrDialogue: string;
  speaker: string;
  durationSec: number;
  characterNames: string[];
}

export interface ScenarioRecord {
  id: string;
  projectId?: string;
  title: string;
  logline: string;
  genre: string;
  tone: string;
  visualStyle: string;
  language: string;
  provider: string;
  totalDurationSec: number;
  scenes: ScenarioScene[];
  createdAt: string;
}

export interface CharacterRecord {
  id: string;
  projectId?: string;
  name: string;
  role: string;
  age: string;
  physicalDescription: string;
  wardrobe: string;
  personality: string;
  voiceStyle: string;
  recommendedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  visualPromptAnchor: string;
  portraitAssetId?: string;
  portraitUrl?: string;
  provider: string;
  createdAt: string;
}

export interface MediaAssetRecord {
  id: string;
  projectId?: string;
  category: MediaCategory;
  filename: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  codec?: string;
  prompt?: string;
  provider: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type LogEngineTag = 'devin' | 'ailleurs' | 'tic-tac' | 'unix' | 'orchestrator';

export interface JobLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  engine?: LogEngineTag;
  message: string;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  step: string;
  provider: string;
  projectId?: string;
  webhookUrl?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  logs: JobLogEntry[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProductionProject {
  id: string;
  name: string;
  prompt: string;
  status: 'draft' | 'producing' | 'completed' | 'failed';
  scenarioId?: string;
  characterIds: string[];
  imageAssetIds: string[];
  audioAssetIds: string[];
  sequenceAssetIds: string[];
  assemblyAssetId?: string;
  exportAssetId?: string;
  activeJobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  requestCount: number;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  capability: 'scenario' | 'character' | 'image' | 'audio' | 'video' | 'assembly';
  license: 'open-source' | 'free-tier' | 'local-engine';
  available: boolean;
  reason: string;
  envOrBinary: string;
  isDefault: boolean;
  installGuide?: {
    summary: string;
    commands: string[];
    envVars: string[];
  };
}
