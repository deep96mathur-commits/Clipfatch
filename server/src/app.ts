import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { apiRouter } from './routes/apiRoutes.js';
import { mp3Handler } from './routes/mp3Route.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';

export function createServerApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Secure Helmet middleware configured for both standard security and iframe embedding
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          mediaSrc: ["'self'", 'blob:', 'https:', 'http:'],
          connectSrc: ["'self'", 'https:', 'http:', 'ws:', 'wss:'],
          frameAncestors: [
            "'self'",
            'https://*.google.com',
            'https://*.aistudio.google.com',
            'https://*.run.app',
          ], // Restrict frame ancestors to self and trusted preview origins to protect against clickjacking
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: false, // Required for preview environment iframe interactions
      crossOriginEmbedderPolicy: false,
      dnsPrefetchControl: { allow: false },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Controlled CORS configuration
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const configuredOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim())
    : [];

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        // Allow same-origin, curl, server-to-server, or local dev requests
        if (!requestOrigin) return callback(null, true);
        if (
          configuredOrigins.length === 0 ||
          configuredOrigins.includes('*') ||
          configuredOrigins.includes(requestOrigin)
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    })
  );

  // Body parser with strict size limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Global & Per-IP rate limiter on API endpoints
  const rateLimitMinutes = parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10);
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  const apiLimiter = createRateLimiter({
    windowMs: rateLimitMinutes * 60 * 1000,
    maxRequests: rateLimitMax,
  });

  app.use('/api', apiLimiter);

  // Security cache headers on API responses
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  app.get('/api/mp3', mp3Handler);

  // Mount API router
  app.use('/api', apiRouter);

  // Global structured error handler
  app.use(errorHandler);

  return app;
}
