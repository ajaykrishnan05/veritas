import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/client.ts';
import type { SessionUser } from '../../src/types/index.ts';

export const SESSION_COOKIE = 'pg_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function createSession(db: DB, userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, expiresAt.toISOString(), new Date(now).toISOString());
  return { token, expiresAt };
}

export function userForSession(db: DB, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT p.id, p.full_name, p.email, p.role, s.expires_at FROM sessions s JOIN profiles p ON p.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as (SessionUser & { expires_at: string }) | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    destroySession(db, token);
    return null;
  }
  return { id: row.id, full_name: row.full_name, email: row.email, role: row.role };
}

export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
