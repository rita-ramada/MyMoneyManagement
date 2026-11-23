import path from 'node:path';
import type { Database } from 'better-sqlite3';
import express from 'express';
import type { AiCategorizer } from './categorize/ai';
import { adminRouter } from './routes/admin';
import { holdingsRouter } from './routes/holdings';
import { importRouter } from './routes/import';
import { reportsRouter } from './routes/reports';
import { setupRouter } from './routes/setup';
import { exportRouter, transactionsRouter } from './routes/transactions';

export interface AppDeps {
  db: Database;
  ai: AiCategorizer | null;
  clientDistDir?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  // DNS-rebinding guard: a web page can point its own domain at 127.0.0.1, but it can't fake the Host header.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return next();
    res.status(403).json({ error: 'Forbidden host' });
  });
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', setupRouter(deps.db));
  app.use('/api', adminRouter(deps.db, deps.ai !== null));
  app.use('/api', importRouter(deps.db, deps.ai));
  app.use('/api', transactionsRouter(deps.db));
  app.use('/api', exportRouter(deps.db));
  app.use('/api', reportsRouter(deps.db));
  app.use('/api', holdingsRouter(deps.db));

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
