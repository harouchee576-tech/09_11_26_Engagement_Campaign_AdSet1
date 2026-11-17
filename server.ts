import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ensureRuntimeDirectories,
  getPublicBaseUrl,
  isOriginAllowed,
  ROOT_DIR,
  SERVER_HOST,
  SERVER_PORT,
} from './server/config.ts';
import { buildOpenApiSpec, renderOpenApiDocsHtml } from './server/openapi.ts';
import { handleHealthCheck, studioRouter, v1Router } from './server/routes/v1.ts';
import { type AuthenticatedRequest, securityHeadersMiddleware } from './server/security.ts';

async function startServer() {
  ensureRuntimeDirectories();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(securityHeadersMiddleware);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origine CORS non autorisée'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-owner-authorized'],
      exposedHeaders: [
        'Content-Length',
        'Content-Range',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
      ],
      optionsSuccessStatus: 204,
    })
  );
  app.use(express.json({ limit: '15mb' }));

  // Public health probes & OpenAPI aliases (Cloud Run, Render, Railway, Fly.io, Lovable)
  app.get('/health', (req, res) => {
    void handleHealthCheck(req as AuthenticatedRequest, res);
  });
  app.get('/healthz', (req, res) => {
    void handleHealthCheck(req as AuthenticatedRequest, res);
  });
  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiSpec(`${getPublicBaseUrl(req)}/api/v1`));
  });
  app.get('/docs', (req, res) => {
    res.type('html').send(renderOpenApiDocsHtml(`${getPublicBaseUrl(req)}/api/v1`));
  });

  app.use('/api/studio', studioRouter);
  app.use('/api/v1', v1Router);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build frontend introuvable. Exécutez npm run build.');
      }
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Endpoint API introuvable.' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.message === 'Origine CORS non autorisée' ? 403 : 500;
    const message =
      process.env.NODE_ENV === 'production' && status === 500
        ? 'Erreur interne du serveur.'
        : err.message || 'Erreur interne du serveur.';
    if (!res.headersSent) {
      res.status(status).json({ error: status === 403 ? 'cors_forbidden' : 'internal_error', message });
    }
  });

  app.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`HAROU GENERATOR 2.0 listening on http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start HAROU GENERATOR 2.0 server:', err);
  process.exit(1);
});

