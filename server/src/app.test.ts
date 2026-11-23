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
