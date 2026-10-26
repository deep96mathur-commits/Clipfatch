import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// In-memory store per client IP
const ipRecords = new Map<string, RateLimitRecord>();

// Cleanup stale records periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRecords.entries()) {
    if (now >= record.resetTime) {
      ipRecords.delete(ip);
    }
  }
}, 60 * 1000);

export function createRateLimiter(options: {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // default 15 minutes
  const maxRequests = options.maxRequests || 100; // default 100 requests per window
  const message = options.message || 'Too many requests from this IP. Please try again later.';

  return (req: Request, res: Response, next: NextFunction) => {
    // Determine client IP safely
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown-ip';

    const now = Date.now();
    let record = ipRecords.get(clientIp);

    if (!record || now >= record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      ipRecords.set(clientIp, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('RateLimit-Limit', maxRequests);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          details: `Limit is ${maxRequests} requests per ${Math.round(windowMs / 60000)} minutes. Try again in ${resetSeconds} seconds.`,
        },
      });
    }

    next();
  };
}
