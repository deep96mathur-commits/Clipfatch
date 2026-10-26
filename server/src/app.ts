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

  // Helmet security headers configured specifically for iframe preview embedding
  app.use(
    helmet({
      frameguard: false, // Disable X-Frame-Options: SAMEORIGIN to allow AI Studio iframe preview
      contentSecurityPolicy: false, // Prevent frame-ancestors 'self' from blocking the iframe
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  // Explicitly ensure headers that break iframe preview are stripped
  app.use((_req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  // CORS configuration
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    })
  );

  // Body parser with strict size limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Per-IP rate limiter on API endpoints
  const rateLimitMinutes = parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10);
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  app.use(
    '/api',
    createRateLimiter({
      windowMs: rateLimitMinutes * 60 * 1000,
      maxRequests: rateLimitMax,
    })
  );

  // Exclude /api routes from platform cookie, caching, and bot-challenge pages
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
