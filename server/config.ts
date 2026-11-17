import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';

export const ROOT_DIR = process.cwd();
export const DATA_DIR = process.env.HAROU_DATA_DIR?.trim()
  ? path.resolve(process.env.HAROU_DATA_DIR.trim())
  : path.join(ROOT_DIR, 'data');
export const STORAGE_DIR = process.env.HAROU_STORAGE_DIR?.trim()
  ? path.resolve(process.env.HAROU_STORAGE_DIR.trim())
  : path.join(ROOT_DIR, 'storage');

export const STORAGE_PATHS = {
  images: path.join(STORAGE_DIR, 'images'),
  audio: path.join(STORAGE_DIR, 'audio'),
  sequences: path.join(STORAGE_DIR, 'sequences'),
  assemblies: path.join(STORAGE_DIR, 'assemblies'),
  exports: path.join(STORAGE_DIR, 'exports'),
} as const;

export function ensureRuntimeDirectories(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const dir of Object.values(STORAGE_PATHS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getPublicBaseUrl(req?: Request): string {
  const publicOverride = process.env.PUBLIC_API_URL?.trim();
  if (publicOverride) {
    return publicOverride.replace(/\/+$/, '');
  }
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL') {
    return configured.replace(/\/+$/, '');
  }
  if (req) {
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader)
      ? protoHeader[0]
      : protoHeader?.split(',')[0]?.trim() || req.protocol || 'http';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (host) {
      return `${proto}://${host}`;
    }
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function getConfiguredCorsOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw || raw === '*') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowList = getConfiguredCorsOrigins();
  if (allowList.length === 0) return true;
  return allowList.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // .lovable.app
      try {
        const hostname = new URL(origin).hostname;
        return hostname === pattern.slice(2) || hostname.endsWith(suffix);
      } catch {
        return false;
      }
    }
    return origin === pattern;
  });
}

export const RATE_LIMIT_RPM = Math.max(
  10,
  Number.parseInt(process.env.RATE_LIMIT_RPM || '180', 10) || 180
);

export const SERVER_PORT = Number(process.env.PORT || 3000);
export const SERVER_HOST = process.env.HOST?.trim() || '0.0.0.0';

