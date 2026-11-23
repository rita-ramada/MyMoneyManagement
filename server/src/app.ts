import path from 'node:path';
import type { Database } from 'better-sqlite3';
import express from 'express';
import type { AiCategorizer } from './categorize/ai';
import { adminRouter } from './routes/admin';
import { importRouter } from './routes/import';
import { setupRouter } from './routes/setup';

export interface AppDeps {
  db: Database;
  ai: AiCategorizer | null;
  clientDistDir?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', setupRouter(deps.db));
  app.use('/api', adminRouter(deps.db, deps.ai !== null));
  app.use('/api', importRouter(deps.db, deps.ai));

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
