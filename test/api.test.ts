import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.ts';
import { createService } from '../src/service.ts';
import { createApp } from '../src/app.ts';

const make = (apiToken = '') => createApp(createService(openDb(':memory:'), 'Asia/Seoul'), { apiToken });

test('layout is seeded from the original rack sheet', async () => {
  const res = await request(make()).get('/api/layout').expect(200);
  assert.equal(res.body.racks.length, 13);
  assert.equal(res.body.racks[0].id, '5-1');
  assert.equal(res.body.racks[0].devices.length, 12);
  assert.equal(res.body.racks.find((r: any) => r.id === '5-9').noKey, true);
});

test('device lifecycle: add, overlap rejected, move, delete, logs', async () => {
  const app = make();
  let res = await request(app).post('/api/racks/5-2/devices')
    .send({ name: 'DELL R740', ip: '10.0.0.1', top: 0, h: 6 }).expect(201);
  const r52 = res.body.racks.find((r: any) => r.id === '5-2');
  assert.equal(r52.status, 'used');
  const dev = r52.devices[0];

  res = await request(app).post('/api/racks/5-2/devices').send({ name: 'X', top: 3, h: 3 }).expect(409);
  assert.match(res.body.error, /DELL R740/);

  // 1/3 폭이면 옆 칸에 들어감
  await request(app).post('/api/racks/5-2/devices').send({ name: 'Y', top: 6, h: 3, col: 2, w: 1 }).expect(201);

  await request(app).post('/api/racks/5-2/devices').send({ name: 'Z', top: 118, h: 3 }).expect(409);
  await request(app).post('/api/racks/5-2/devices').send({ name: '', top: 30, h: 3 }).expect(400);

  res = await request(app).patch(`/api/devices/${dev.id}`)
    .send({ ...dev, rackId: '5-5', top: 30 }).expect(200);
  assert.equal(res.body.racks.find((r: any) => r.id === '5-5').devices[0].id, dev.id);

  await request(app).delete(`/api/devices/${dev.id}`).expect(200);
  await request(app).delete(`/api/devices/${dev.id}`).expect(404);

  const logs = (await request(app).get('/api/logs').expect(200)).body;
  assert.equal(logs.length, 4);
  assert.match(logs[0].text, /반출/);
  assert.match(logs[3].text, /DELL R740 \(10\.0\.0\.1\) 반입, 5-2조 U1 위칸 ~ U2 아래칸 \(2U\)/);
});

test('rack patch', async () => {
  const app = make();
  const res = await request(app).patch('/api/racks/5-2').send({ tenant: 'ACME', door: true, checked: '2026-11-10' }).expect(200);
  const r = res.body.racks.find((x: any) => x.id === '5-2');
  assert.equal(r.tenant, 'ACME');
  assert.equal(r.door, true);
  await request(app).patch('/api/racks/5-2').send({ status: 'nope' }).expect(400);
  await request(app).patch('/api/racks/nope').send({ tenant: 'x' }).expect(404);
});

test('API_TOKEN protects writes only', async () => {
  const app = make('secret');
  await request(app).get('/api/layout').expect(200);
  await request(app).patch('/api/racks/5-2').send({ tenant: 'x' }).expect(401);
  await request(app).patch('/api/racks/5-2').set('Authorization', 'Bearer bad').send({ tenant: 'x' }).expect(403);
  await request(app).patch('/api/racks/5-2').set('Authorization', 'Bearer secret').send({ tenant: 'x' }).expect(200);
});
