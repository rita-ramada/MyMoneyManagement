import type http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp } from './app';

export function startServer(port: number, app?: Express): http.Server {
  const instance = app ?? createApp({ db: null, ai: null });
  return instance.listen(port, '127.0.0.1');
}

// Real boot runs only when this file is the entry module (no side effects on import).
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file; fine
  }
  // Task 2: open the DB (data/finance.db) and build the AI client here, then pass to createApp.
  const port = Number(process.env.PORT ?? 4321);
  const clientDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  const server = startServer(port, createApp({ db: null, ai: null, clientDistDir }));
  server.on('listening', () => console.log(`Listening on http://127.0.0.1:${port}`));
}
