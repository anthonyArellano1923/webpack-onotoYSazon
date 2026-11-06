/**
 * PLAN-13: amount caps and strict types across admin, stock, batches, packs,
 * settings and the orders service. Hits the real admin routes over HTTP.
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { MAX_MONTO_CLP } = require('../utils/limits');

let server;
let baseUrl;
let token;
const ADMIN_ID = 777;

before(async () => {
  token = jwt.sign({ sub: ADMIN_ID, phone: '+56911112222', role: 'admin' }, process.env.JWT_SECRET);
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

/** Sends an authenticated admin request; returns { status, body }. */
async function call(method, route, body) {
  // resetDb() borra los usuarios: el admin se recrea antes de cada llamada.
  h.db.prepare(
    "INSERT OR IGNORE INTO users (id, name, phone, password_hash, role) VALUES (?, 'Dueño', '+56911112222', 'x', 'admin')"
  ).run(ADMIN_ID);
  const res = await fetch(`${baseUrl}/api/admin${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Asserts that every payload is answered with 400 (never 500). */
async function all400(method, route, payloads) {
  for (const p of payloads) {
    const r = await call(method, route, p);
    assert.equal(r.status, 400, `${method} ${route} ${JSON.stringify(p)} → ${r.status}`);
    assert.ok(typeof r.body.error === 'string');
  }
}

const HUGE = [1e300, MAX_MONTO_CLP + 1, -1, 1.5, '5000', {}, [1], true];

test('venta manual: totalClp fuera de tope o de tipo → 400', async () => {
  await all400('POST', '/orders', HUGE.map((totalClp) => ({ customerName: 'X', quantityHallacas: 2, totalClp })));
  // El tope exacto sí se acepta.
  h.addStock(10);
  const ok = await call('POST', '/orders', { customerName: 'X', quantityHallacas: 2, totalClp: MAX_MONTO_CLP });
  assert.equal(ok.status, 201);
});

test('venta manual: tipos inesperados → 400', async () => {
  await all400('POST', '/orders', [
    { customerName: 'X', quantityHallacas: true },
    { customerName: 'X', quantityHallacas: [7] },
    { customerName: 'X', quantityHallacas: 2, status: {} },
    { customerName: 'X', quantityHallacas: 2, paymentMethod: [] },
    { customerName: 'X', quantityHallacas: 2, customerPhone: {} },
    { customerName: { a: 1 }, quantityHallacas: 2 },
    { customerName: 'X', quantityHallacas: 2, notes: 5 },
  ]);
});

test('PATCH de venta: totalClp y delivered con tope/tipo → 400', async () => {
  h.resetDb();
  h.addStock(10);
  const id = h.manualSale({ quantityHallacas: 1, totalClp: 1000 }).body.order.id;
  await all400('PATCH', `/orders/${id}`, [
    ...HUGE.map((totalClp) => ({ totalClp })),
    { delivered: 'no' },
    { status: {} },
    { quantityHallacas: 1e300 },
  ]);
});

test('packs y ajustes: precio fuera de tope o isAvailable no booleano → 400', async () => {
  await all400('PATCH', '/packs/p1', [
    ...[1e300, MAX_MONTO_CLP + 1, '100', {}].map((priceClp) => ({ priceClp })),
    { isAvailable: 'false' },
    { isAvailable: 0 },
  ]);
  await all400('PATCH', '/settings', [1e300, MAX_MONTO_CLP + 1, '100', {}, null].map((v) => ({ price_per_hallaca: v })));
});

test('tandas: costo fuera de tope y notas no texto → 400 (crear y editar)', async () => {
  await all400('POST', '/batches', [
    ...[1e300, MAX_MONTO_CLP + 1, '1000', {}].map((costTotalClp) => ({ quantity: 10, costTotalClp })),
    { quantity: 10, notes: 5 },
    { quantity: 10, notes: { a: 1 } },
    { quantity: 10, producedAt: {} },
  ]);
  const created = await call('POST', '/batches', { quantity: 10, costTotalClp: 1000 });
  assert.equal(created.status, 201);
  const id = created.body.batch.id;
  await all400('PATCH', `/batches/${id}`, [
    { costTotalClp: 1e300 }, { costTotalClp: MAX_MONTO_CLP + 1 }, { notes: 5 }, { notes: {} },
  ]);
});

test('movimientos de stock: reason/delta/fecha con tipo inválido → 400', async () => {
  await all400('POST', '/stock/movements', [
    { delta: 5, reason: {} },
    { delta: 5, reason: ['abc'] },
    { delta: 5, reason: 12345 },
    { delta: '5', reason: 'abc' },
    { delta: 1e300, reason: 'abc' },
    { delta: 5, reason: 'abc', occurredAt: {} },
  ]);
});

test('checkout público: textos con tipo inválido → 400 y no 500', async () => {
  const bad = [
    { name: ['x'], phone: '912345678', items: [{ packId: 'p1', qty: 1 }] },
    { name: 'X', phone: {}, items: [{ packId: 'p1', qty: 1 }] },
    { name: 'X', phone: '912345678', items: [{ packId: 'p1', qty: 1 }], notes: { a: 1 } },
    { name: 'X', phone: '912345678', items: [{ packId: 'p1', qty: 1 }], dateHint: [1] },
    { name: 'X', phone: '912345678', items: [{ packId: {}, qty: 1 }] },
  ];
  for (const b of bad) {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    assert.equal(res.status, 400, JSON.stringify(b));
  }
});

test('auth: password/nombre no texto → 400', async () => {
  for (const [route, b] of [
    ['login', { phone: '912345678', password: { a: 1 } }],
    ['register', { name: ['x'], phone: '912345678', password: 'Abcdefg1' }],
  ]) {
    const res = await fetch(`${baseUrl}/api/auth/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    assert.equal(res.status, 400, route);
  }
});
