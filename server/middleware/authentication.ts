import type { NextFunction, Request, Response } from 'express';
import type { DB } from '../db/client.ts';
import { SESSION_COOKIE, parseCookies, userForSession } from '../auth/sessions.ts';
import { ApiError } from '../http-error.ts';
import type { SessionUser } from '../../src/types/index.ts';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function attachUser(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = userForSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]) ?? undefined;
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new ApiError(401, 'unauthenticated', 'Please sign in to continue.'));
  next();
}

/** Mutating requests must carry a custom header, which cross-site forms cannot set (CSRF defense in depth with SameSite). */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-payguard-csrf'] !== '1') {
    return next(new ApiError(403, 'csrf', 'Missing required request header.'));
  }
  next();
}
