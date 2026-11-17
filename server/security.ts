import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { DATA_DIR, ensureRuntimeDirectories, RATE_LIMIT_RPM } from './config.ts';
import type { ApiKeyRecord } from './types.ts';

const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
export const STUDIO_COOKIE_NAME = 'harou_studio_sid';

let cachedSessionSecret: string | null = null;
let cachedKeys: ApiKeyRecord[] | null = null;

function getSessionSecret(): string {
  const envSecret = process.env.HAROU_SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }
  if (cachedSessionSecret) return cachedSessionSecret;
  ensureRuntimeDirectories();
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    cachedSessionSecret = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
    if (cachedSessionSecret.length >= 32) {
      return cachedSessionSecret;
    }
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SESSION_SECRET_FILE, secret, { mode: 0o600 });
  cachedSessionSecret = secret;
  return secret;
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function getEnvMasterKeys(): string[] {
  const keys: string[] = [];
  const single = process.env.HAROU_API_KEY?.trim();
  if (single) keys.push(single);
  const multi = process.env.HAROU_API_KEYS?.trim();
  if (multi) {
    for (const part of multi.split(',')) {
      const clean = part.trim();
      if (clean && !keys.includes(clean)) keys.push(clean);
    }
  }
  return keys;
}

export function hasConfiguredEnvApiKeys(): boolean {
  return getEnvMasterKeys().length > 0;
}

function verifyEnvMasterKey(rawKey: string): boolean {
  const candidates = getEnvMasterKeys();
  if (candidates.length === 0) return false;
  const candidateDigest = crypto.createHash('sha256').update(rawKey).digest();
  for (const configured of candidates) {
    const expectedDigest = crypto.createHash('sha256').update(configured).digest();
    if (crypto.timingSafeEqual(candidateDigest, expectedDigest)) {
      return true;
    }
  }
  return false;
}

function loadKeys(): ApiKeyRecord[] {
  if (cachedKeys) return cachedKeys;
  ensureRuntimeDirectories();
  if (!fs.existsSync(KEYS_FILE)) {
    cachedKeys = [];
    return cachedKeys;
  }
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf8');
    cachedKeys = JSON.parse(raw) as ApiKeyRecord[];
  } catch {
    cachedKeys = [];
  }
  return cachedKeys;
}

function saveKeys(keys: ApiKeyRecord[]): void {
  ensureRuntimeDirectories();
  cachedKeys = keys;
  const tmp = `${KEYS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(keys, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, KEYS_FILE);
}

export function listApiKeys(): Array<Omit<ApiKeyRecord, 'hash'>> {
  return loadKeys().map(({ hash: _hash, ...rest }) => rest);
}

export function createApiKey(name: string, scopes: string[] = ['*']): {
  record: Omit<ApiKeyRecord, 'hash'>;
  plaintextKey: string;
} {
  const cleanName = name.trim() || 'HAROU AI Client';
  const rawSecret = `hg_live_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = rawSecret.slice(0, 15);
  const record: ApiKeyRecord = {
    id: `key_${crypto.randomUUID().slice(0, 12)}`,
    name: cleanName,
    prefix,
    hash: hashApiKey(rawSecret),
    scopes,
    requestCount: 0,
    createdAt: new Date().toISOString(),
  };
  const keys = loadKeys();
  keys.unshift(record);
  saveKeys(keys);
  const { hash: _hash, ...publicRecord } = record;
  return { record: publicRecord, plaintextKey: rawSecret };
}

export function revokeApiKey(id: string): boolean {
  const keys = loadKeys();
  const target = keys.find((k) => k.id === id);
  if (!target) return false;
  target.revokedAt = new Date().toISOString();
  saveKeys(keys);
  return true;
}

export function issueStudioSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'studio',
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyStudioSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  if (sig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return false;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

export function issueSignedMediaToken(
  category: string,
  filename: string,
  ttlSec = 3600
): { token: string; expiresAt: string } {
  const clampedTtl = Math.min(86400, Math.max(60, ttlSec));
  const exp = Date.now() + clampedTtl * 1000;
  const payload = Buffer.from(
    JSON.stringify({ c: category, f: filename, exp })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`media:${payload}`)
    .digest('base64url');
  return {
    token: `${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifySignedMediaToken(
  token: string | undefined,
  category: string,
  filename: string
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`media:${payload}`)
    .digest('base64url');
  if (sig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return false;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      c?: string;
      f?: string;
      exp?: number;
    };
    return (
      decoded.c === category &&
      decoded.f === filename &&
      typeof decoded.exp === 'number' &&
      decoded.exp > Date.now()
    );
  } catch {
    return false;
  }
}

export function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(eqIndex + 1).trim());
    }
  }
  return undefined;
}

export function extractBearerOrApiKey(req: Request): string | undefined {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const queryKey = req.query.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) {
    return queryKey.trim();
  }
  return undefined;
}

export interface AuthenticatedRequest extends Request {
  authContext?: {
    mode: 'api_key' | 'studio_session' | 'signed_media_token';
    keyId?: string;
    keyName?: string;
  };
}

export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (process.env.NODE_ENV === 'production' && proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function apiRateLimiter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 60_000;
  const bucketKey =
    req.authContext?.keyId ||
    `ip:${(req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'}`;

  let entry = rateBuckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(bucketKey, entry);
  }
  entry.count += 1;

  // Periodic cleanup if map grows large
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }

  const remaining = Math.max(0, RATE_LIMIT_RPM - entry.count);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_RPM));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > RATE_LIMIT_RPM) {
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `Limite de ${RATE_LIMIT_RPM} requêtes par minute dépassée. Réessayez dans quelques secondes.`,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    });
    return;
  }

  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // 1. Allow short-lived HMAC signed tokens strictly on GET /media/:category/:filename
  if (req.method === 'GET' && req.path.startsWith('/media/') && typeof req.query.token === 'string') {
    const parts = req.path.replace(/^\/media\//, '').split('/');
    if (parts.length === 2) {
      const [category, filename] = parts;
      if (verifySignedMediaToken(req.query.token, category, path.basename(filename))) {
        req.authContext = { mode: 'signed_media_token' };
        next();
        return;
      }
    }
  }

  // 2. Check external REST API key (env master key or persisted SHA-256 key)
  const rawKey = extractBearerOrApiKey(req);
  if (rawKey) {
    if (verifyEnvMasterKey(rawKey)) {
      req.authContext = {
        mode: 'api_key',
        keyId: 'env_master_key',
        keyName: 'Clé serveur HAROU_API_KEY',
      };
      next();
      return;
    }

    const hashed = hashApiKey(rawKey);
    const keys = loadKeys();
    const match = keys.find((k) => !k.revokedAt && k.hash === hashed);
    if (!match) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Clé API HAROU GENERATOR invalide ou révoquée.',
      });
      return;
    }
    match.requestCount += 1;
    match.lastUsedAt = new Date().toISOString();
    saveKeys(keys);
    req.authContext = {
      mode: 'api_key',
      keyId: match.id,
      keyName: match.name,
    };
    next();
    return;
  }

  // 3. Check HttpOnly Studio Session cookie (for the web control console)
  const sessionToken = parseCookie(req.headers.cookie, STUDIO_COOKIE_NAME);
  if (verifyStudioSessionToken(sessionToken)) {
    req.authContext = {
      mode: 'studio_session',
    };
    next();
    return;
  }

  res.status(401).json({
    error: 'unauthorized',
    message:
      'Authentification requise. Fournissez le header x-api-key ou Authorization: Bearer <clé>.',
  });
}

