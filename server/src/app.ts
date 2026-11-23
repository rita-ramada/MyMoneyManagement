import path from 'node:path';
import express from 'express';

export interface AppDeps {
  // Task 2 replaces `unknown` with the Database type; AI type arrives later.
  db: unknown;
  ai: unknown | null;
  clientDistDir?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  if (deps.clientDistDir) {
    const dist = deps.clientDistDir;
    app.use(express.static(dist));
    // SPA fallback for non-API GET requests.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}
