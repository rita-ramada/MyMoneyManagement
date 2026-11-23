import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { Router } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from '../db/repo';

const settingsPatchSchema = z.object({
  transferPatterns: z.array(z.string().trim().min(1)).optional(),
  aiEnabled: z.boolean().optional(),
});

const pad = (n: number) => String(n).padStart(2, '0');
function timestamp(d: Date): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${date}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function adminRouter(db: Database, aiConfigured: boolean): Router {
  const r = Router();

  const readSettings = () => ({
    transferPatterns: getSetting<string[]>(db, 'transferPatterns', []),
    aiEnabled: getSetting<boolean>(db, 'aiEnabled', true),
    aiConfigured,
  });

  r.get('/settings', (_req, res) => {
    res.json(readSettings());
  });

  r.put('/settings', (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      res.status(400).json({ error });
      return;
    }
    const { transferPatterns, aiEnabled } = parsed.data;
    if (transferPatterns !== undefined) setSetting(db, 'transferPatterns', transferPatterns);
    if (aiEnabled !== undefined) setSetting(db, 'aiEnabled', aiEnabled);
    res.json(readSettings());
  });

  r.post('/backup', async (_req, res, next) => {
    try {
      if (db.memory || !db.name || db.name === ':memory:') {
        res.status(400).json({ error: 'Cannot back up an in-memory database' });
        return;
      }
      const dir = path.join(path.dirname(path.resolve(db.name)), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `finance-${timestamp(new Date())}.db`);
      await db.backup(file);
      res.json({ file });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
