import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/client.ts';
import { ApiError } from '../http-error.ts';
import { requireAuth } from '../middleware/authentication.ts';
import { verifyPassword } from './passwords.ts';
import { SESSION_COOKIE, createSession, destroySession, parseCookies } from './sessions.ts';

const loginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// Simple in-memory throttle: 10 failed attempts per email+IP per 15 minutes.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Verified against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

export function authRouter(db: DB, secureCookies: boolean): Router {
  const router = Router();

  router.post('/login', (req, res, next) => {
    try {
      const body = loginBody.safeParse(req.body);
      if (!body.success) throw new ApiError(400, 'invalid_request', 'Enter a valid email and password.');
      const email = body.data.email.toLowerCase();
      const key = `${req.ip}|${email}`;
      const now = Date.now();
      const rec = attempts.get(key);
      if (rec && rec.resetAt > now && rec.count >= MAX_ATTEMPTS) throw new ApiError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Try again later.');

      const user = db.prepare('SELECT id, full_name, email, role, password_hash FROM profiles WHERE email = ?').get(email) as
        | { id: string; full_name: string; email: string; role: 'finance_operator' | 'chief_auditor'; password_hash: string }
        | undefined;
      const ok = verifyPassword(body.data.password, user?.password_hash ?? DUMMY_HASH) && !!user;
      if (!ok || !user) {
        const fresh = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + WINDOW_MS };
        fresh.count++;
        attempts.set(key, fresh);
        throw new ApiError(401, 'invalid_credentials', 'Incorrect email or password.');
      }
      attempts.delete(key);
      const { token, expiresAt } = createSession(db, user.id);
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, expires: expiresAt, path: '/' });
      res.json({ id: user.id, full_name: user.full_name, email: user.email, role: user.role });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  return router;
}
