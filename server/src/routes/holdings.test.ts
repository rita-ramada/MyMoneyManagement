import request from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db/db';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;
const body = { name: 'World ETF', type: 'etf', startDate: '2026-01-01', expectedAnnualReturn: 0.12 };
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
const monthlyBody = { kind: 'monthly', amountCents: 10000, effectiveFrom: '2026-01-01' };

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, ai: null });
});

describe('holdings API', () => {
  test('create, list, update', async () => {
    const created = await request(app).post('/api/holdings').send(body);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 1, ...body });
    expect((await request(app).get('/api/holdings')).body).toEqual([created.body]);
    const upd = await request(app).put('/api/holdings/1').send({ ...body, name: 'Renamed' });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Renamed');
    expect((await request(app).put('/api/holdings/99').send(body)).status).toBe(404);
    expect((await request(app).put('/api/holdings/1').send({ ...body, type: 'bond' })).status).toBe(400);
  });

  test('validation: 400s and 404s', async () => {
    const bad = [
      { ...body, expectedAnnualReturn: 1.5 },
      { ...body, expectedAnnualReturn: -1.01 },
      { ...body, type: 'bond' },
      { ...body, startDate: '2026-02-31' },
      { ...body, name: undefined },
    ];
    for (const b of bad) expect((await request(app).post('/api/holdings').send(b)).status).toBe(400);
    await request(app).post('/api/holdings').send(body);
    const c = (b: object) => request(app).post('/api/holdings/1/contributions').send(b);
    expect((await c({ ...monthlyBody, amountCents: -5 })).status).toBe(400);
    expect((await c({ ...monthlyBody, amountCents: 1.5 })).status).toBe(400);
    expect((await c({ ...monthlyBody, kind: 'weekly' })).status).toBe(400);
    expect((await c({ ...monthlyBody, effectiveFrom: 'x' })).status).toBe(400);
    const v = (b: object) => request(app).post('/api/holdings/1/valuations').send(b);
    expect((await v({ date: '2026-01-20', valueCents: -1 })).status).toBe(400);
    expect((await v({ date: '2026-13-20', valueCents: 1 })).status).toBe(400);
    expect((await request(app).post('/api/holdings/99/contributions').send(monthlyBody)).status).toBe(404);
    expect((await request(app).post('/api/holdings/99/valuations').send({ date: '2026-01-20', valueCents: 1 })).status).toBe(404);
  });

  test('deleting a holding removes its contributions and valuations', async () => {
    await request(app).post('/api/holdings').send(body);
    await request(app).post('/api/holdings/1/contributions').send(monthlyBody);
    await request(app).post('/api/holdings/1/valuations').send({ date: '2026-01-20', valueCents: 15000 });
    expect((await request(app).delete('/api/holdings/1')).status).toBe(204);
    expect(count('holdings') + count('holding_contributions') + count('holding_valuations')).toBe(0);
    expect((await request(app).delete('/api/holdings/1')).status).toBe(404);
  });

  test('delete a single contribution / valuation', async () => {
    await request(app).post('/api/holdings').send(body);
    const c = await request(app).post('/api/holdings/1/contributions').send({ ...monthlyBody, kind: 'one_off' });
    const v = await request(app).post('/api/holdings/1/valuations').send({ date: '2026-01-20', valueCents: 15000 });
    expect(c.status).toBe(201);
    expect(v.status).toBe(201);
    expect((await request(app).delete(`/api/holding-contributions/${c.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/holding-valuations/${v.body.id}`)).status).toBe(204);
    expect((await request(app).delete('/api/holding-contributions/99')).status).toBe(404);
    expect((await request(app).delete('/api/holding-valuations/99')).status).toBe(404);
  });
});

describe('GET /api/reports/investments', () => {
  test('report returns the series, latest confirmed point and gain', async () => {
    await request(app).post('/api/holdings').send(body);
    await request(app).post('/api/holdings/1/contributions').send(monthlyBody);
    await request(app).post('/api/holdings/1/valuations').send({ date: '2026-02-20', valueCents: 21000 });
    const res = await request(app).get('/api/reports/investments?until=2026-02');
    expect(res.status).toBe(200);
    const [row] = res.body.holdings;
    expect(row.holding).toEqual({ id: 1, ...body });
    expect(row.series).toHaveLength(2);
    expect(row.series[0]).toMatchObject({ valueCents: 10095, confirmed: false });
    expect(row.latest).toEqual({ month: '2026-02', contributedCents: 20000, valueCents: 21000, confirmed: true });
    expect(row.gainCents).toBe(1000);
    expect(row.gainPct).toBe(0.05);
  });

  test('empty series: latest null, zero gain; bad until is 400', async () => {
    await request(app).post('/api/holdings').send(body);
    const res = await request(app).get('/api/reports/investments?until=2025-12');
    expect(res.body.holdings[0]).toMatchObject({ series: [], latest: null, gainCents: 0, gainPct: 0 });
    expect((await request(app).get('/api/reports/investments?until=2025-13')).status).toBe(400);
  });
});

describe('GET /api/export/holdings.csv', () => {
  test('columns, Estimated status and last-day value date', async () => {
    await request(app).post('/api/holdings').send(body);
    await request(app).post('/api/holdings/1/contributions').send(monthlyBody);
    const res = await request(app).get('/api/export/holdings.csv?until=2026-02');
    expect(res.headers['content-disposition']).toBe('attachment; filename="holdings.csv"');
    expect(res.text).toBe(
      '﻿Holding;Contributed;Value;Value date;Status\r\nWorld ETF;200,00;202,86;2026-02-28;Estimated\r\n',
    );
  });

  test('confirmed latest uses the valuation date', async () => {
    await request(app).post('/api/holdings').send(body);
    await request(app).post('/api/holdings/1/valuations').send({ date: '2026-02-20', valueCents: 15000 });
    const res = await request(app).get('/api/export/holdings.csv?until=2026-02');
    expect(res.text).toBe('﻿Holding;Contributed;Value;Value date;Status\r\nWorld ETF;0,00;150,00;2026-02-20;Confirmed\r\n');
  });

  test('formula injection: a holding name starting with + is prefixed with an apostrophe', async () => {
    await request(app).post('/api/holdings').send({ ...body, name: '+Gold' });
    const res = await request(app).get('/api/export/holdings.csv?until=2026-01');
    expect(res.text.split('\r\n')[1].startsWith("'+Gold;")).toBe(true);
  });
});
