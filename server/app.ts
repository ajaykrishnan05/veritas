import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { DB } from './db/client.ts';
import { auditRouter } from './audit/router.ts';
import { authRouter } from './auth/router.ts';
import { ApiError } from './http-error.ts';
import { invoiceRouter } from './invoices/router.ts';
import { attachUser, requireAuth, requireCsrfHeader } from './middleware/authentication.ts';
import { createProvider, type AiProvider } from './services/ai/provider.ts';
import { LocalStorage, type StorageProvider } from './storage/index.ts';

export interface AppOptions {
  db: DB;
  config: Config;
  provider?: AiProvider | null;
  storage?: StorageProvider;
  demoDir?: string;
}

export function createApp({ db, config, provider, storage, demoDir }: AppOptions) {
  const app = express();
  const store = storage ?? new LocalStorage(config.uploadDir);
  const ai = provider === undefined ? createProvider(config) : provider;

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(attachUser(db));
  app.use('/api', requireCsrfHeader);

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai_provider: ai ? ai.name : 'deterministic-demo-fallback' }));
  app.use('/api/auth', authRouter(db, config.nodeEnv === 'production'));
  app.get('/api/vendors', requireAuth, (_req, res) => {
    res.json(db.prepare("SELECT id, vendor_code, legal_name, display_name, status FROM vendors ORDER BY display_name").all());
  });
  app.use(
    '/api/invoices',
    requireAuth,
    invoiceRouter({ db, config, storage: store, pipeline: { db, storage: store, provider: ai }, demoDir: demoDir ?? path.resolve('demo-invoices') }),
  );
  app.use('/api/audit', requireAuth, auditRouter(db));
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not_found', 'Not found.')));

  // Built frontend (production / `npm start`).
  const webDir = path.resolve('dist/web');
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    } else if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? 'file_too_large' : 'upload_error', message: tooBig ? `File exceeds the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit.` : 'The upload could not be read.' } });
    } else if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    } else {
      // Log the message only: never request bodies, headers or secrets.
      console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown');
      res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
    }
  };
  app.use(onError);
  return app;
}
