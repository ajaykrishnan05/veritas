import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { migrate, openDb, type DB } from '../../server/db/client.ts';
import type { AiProvider } from '../../server/services/ai/provider.ts';
import { LocalStorage } from '../../server/storage/index.ts';
import { seedDatabase, writeDemoPdfs } from '../../scripts/seed/index.ts';

export const PASSWORD = 'test-password-123';

export function makeCtx(opts: { provider?: AiProvider | null; env?: Record<string, string> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payguard-test-'));
  const db: DB = openDb(':memory:');
  migrate(db);
  seedDatabase(db, PASSWORD);
  const demoDir = path.join(dir, 'demo');
  writeDemoPdfs(demoDir);
  const config = loadConfig({ DATABASE_PATH: ':memory:', UPLOAD_DIR: path.join(dir, 'uploads'), ...opts.env } as NodeJS.ProcessEnv);
  const app = createApp({ db, config, provider: opts.provider ?? null, storage: new LocalStorage(config.uploadDir), demoDir });
  return { app, db, dir, demoDir };
}

export type Ctx = ReturnType<typeof makeCtx>;

export async function login(ctx: Ctx, who: 'operator' | 'auditor') {
  const agent = request.agent(ctx.app);
  const res = await agent.post('/api/auth/login').set('X-PayGuard-CSRF', '1').send({ email: `${who}@payguard.demo`, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string) => agent.post(url).set('X-PayGuard-CSRF', '1'),
  };
}

export type Client = Awaited<ReturnType<typeof login>>;

export async function processDemo(c: Client, key: string): Promise<string> {
  const res = await c.post(`/api/invoices/demo/${key}?wait=1`);
  if (res.status !== 202) throw new Error(`demo ${key} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}
