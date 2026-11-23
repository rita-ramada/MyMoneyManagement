import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp } from './app';
import Anthropic from '@anthropic-ai/sdk';
import { openDb } from './db/db';
import { createClaudeCategorizer } from './categorize/ai';

export function startServer(port: number, app?: Express): http.Server {
  const instance = app ?? createApp({ db: openDb(':memory:'), ai: null });
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
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'finance.db'));
  const log = process.env.LOG_AI_PAYLOAD === '1' ? (payload: unknown) => console.debug('[ai payload]', JSON.stringify(payload)) : undefined;
  const ai = process.env.ANTHROPIC_API_KEY ? createClaudeCategorizer(new Anthropic(), log) : null;
  const port = Number(process.env.PORT ?? 4321);
  const clientDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  const server = startServer(port, createApp({ db, ai, clientDistDir }));
  server.on('listening', () => console.log(`Listening on http://127.0.0.1:${port}`));
}
