import path from 'node:path';
import type { Database } from 'better-sqlite3';
import express from 'express';

export interface AppDeps {
  db: Database;
  // AI type arrives in a later task.
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
