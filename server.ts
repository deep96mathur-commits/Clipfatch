import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import { createServerApp } from './server/src/app.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev server must run on port 3000 in AI Studio environment
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = createServerApp();

  if (!isProd) {
    // Development mode: Mount Vite middleware for React SPA with HMR
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    // Production mode: Serve pre-built static bundle
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));

    // Fallback to index.html for SPA routing
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ClipFetch] Server listening on http://0.0.0.0:${PORT} (mode: ${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[ClipFetch] Fatal server startup error:', err);
  process.exit(1);
});
