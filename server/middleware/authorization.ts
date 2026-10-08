import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../http-error.ts';
import type { Role } from '../../src/types/index.ts';

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'unauthenticated', 'Please sign in to continue.'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'forbidden', 'Your role is not permitted to perform this action.'));
    next();
  };
}
