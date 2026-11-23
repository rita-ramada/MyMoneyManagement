import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { Express } from 'express';
import { createApp } from './app';
import { bootOptions, openInBrowser } from './boot';
import { createClaudeCategorizer } from './categorize/ai';
import { openDb } from './db/db';

export function startServer(port: number, app?: Express): http.Server {
  const instance = app ?? createApp({ db: openDb(':memory:'), ai: null });
  return instance.listen(port, '127.0.0.1');
}

// Real boot runs only when this file is the entry module (no side effects on import).
const here = path.dirname(fileURLToPath(import.meta.url));
const isEntry = !!process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '') === fileURLToPath(import.meta.url).replace(/\.ts$/, '');
if (isEntry) {
  try {
    process.loadEnvFile(path.resolve(here, '../../.env'));
  } catch {
    // no .env file; fine
  }
  const opts = bootOptions(process.env, here);
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const db = openDb(path.join(opts.dataDir, 'finance.db'));
  const log = process.env.LOG_AI_PAYLOAD === '1' ? (payload: unknown) => console.debug('[ai payload]', JSON.stringify(payload)) : undefined;
  const ai = process.env.ANTHROPIC_API_KEY ? createClaudeCategorizer(new Anthropic(), log) : null;
  if (!opts.clientDistDir) console.warn('client/dist not found — run `npm start` from the repo root to build the UI.');
  const server = startServer(opts.port, createApp({ db, ai, clientDistDir: opts.clientDistDir }));
  server.on('listening', () => {
    const url = `http://127.0.0.1:${opts.port}`;
    console.log(`MyMoneyManagement running at ${url} (data: ${opts.dataDir}${ai ? ', AI on' : ', AI off — no API key'})`);
    if (opts.openBrowser) openInBrowser(url);
  });
}
