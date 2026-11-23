import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db/db';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { test, expect } from 'vitest';
import { createApp } from './app';
import { startServer } from './index';

test('GET /api/health returns ok', async () => {
  const app = createApp({ db: null as any, ai: null });
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test('server binds to 127.0.0.1 only', async () => {
  const server = startServer(0);
  await once(server, 'listening');
  expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  server.close();
});

test('serves the built client for non-API routes and keeps /api JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-dist-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>MyMoney</title>');
    const app = createApp({ db: openDb(':memory:'), ai: null, clientDistDir: dir });
    const page = await request(app).get('/investments');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.text).toContain('<title>MyMoney</title>');
    const health = await request(app).get('/api/health');
    expect(health.body).toEqual({ ok: true });
    expect((await request(app).get('/api/nope')).status).toBe(404);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects requests whose Host is not local (DNS rebinding guard, final review I6)', async () => {
  const app = createApp({ db: openDb(':memory:'), ai: null });
  expect((await request(app).get('/api/health').set('Host', 'evil.example:4321')).status).toBe(403);
  expect((await request(app).get('/api/health').set('Host', 'rebind.attacker.test')).status).toBe(403);
  expect((await request(app).get('/api/health').set('Host', 'localhost:5173')).status).toBe(200);
  expect((await request(app).get('/api/health').set('Host', '127.0.0.1:4321')).status).toBe(200);
  expect((await request(app).get('/api/health').set('Host', '[::1]:4321')).status).toBe(200);
});
