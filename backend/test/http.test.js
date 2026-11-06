/**
 * PLAN-11: route-level checks through the real orders router (T14). The
 * .escape() lived in the route validators, so calling the controller directly
 * would pass whether or not it was removed.
 *
 * orderLimiter allows 10 requests per hour per IP: keep HTTP calls here few.
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const orderRoutes = require('../routes/orders.routes');
const packsRoutes = require('../routes/packs.routes');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/orders', orderRoutes);
  app.use('/api/packs', packsRoutes);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('T14: notas y dirección se guardan sin escapar', async () => {
  h.resetDb();
  h.addStock(20);
  const notes = 'Av. O\'Higgins & <b>x</b>';
  const address = 'O\'Higgins & "Los Leones" 123, Providencia';

  const res = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cliente', phone: '912345678', items: [{ packId: 'p1', qty: 2 }],
      delivery: 'despacho', address, notes,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));

  const row = h.getOrder(body.order.id);
  assert.equal(row.notes, notes);
  assert.equal(row.address, address);
});

test('409 por HTTP devuelve { error, code } y /api/packs expone limits', async () => {
  h.resetDb();
  h.addStock(5);
  const res = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cliente', phone: '912345678', items: [{ packId: 'p1', qty: 6 }] }),
  });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    error: 'Para un pedido así, ponte en contacto directo con el vendedor.',
    code: 'SIN_STOCK',
  });

  const packs = await (await fetch(`${baseUrl}/api/packs`)).json();
  assert.deepEqual(packs.limits, { maxHallacasPorTelefono: 20, holdHours: 24 });
  assert.equal(packs.stock_available, 5);
});
