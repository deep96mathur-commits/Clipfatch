import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

export function createRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
}) {
  const windowMs = options?.windowMs || 15 * 60 * 1000;
  const max = options?.maxRequests || 100;
  const message = options?.message || 'Too many requests from this IP. Please try again later.';

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: true,
    validate: {
      xForwardedForHeader: false,
      default: true,
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          details: `Limit is ${max} requests per ${Math.round(windowMs / 60000)} minutes.`,
        },
      });
    },
  });
}
