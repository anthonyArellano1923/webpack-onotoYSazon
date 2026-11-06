/**
 * STOCK FASE 2 (punto 5): ventas, movimientos y tandas rechazan fechas
 * futuras con 400.
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMovement } = require('../controllers/stock.controller');
const { createBatch, updateBatch } = require('../controllers/batches.controller');
const { hoyLocal } = require('../utils/fecha');

beforeEach(() => h.resetDb());

/** YYYY-MM-DD shifted `days` from today (local). */
function dia(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

/** Calls a controller with a body (and optional params). */
function call(fn, body, params = {}) {
  const res = h.mockRes();
  fn({ body, params, user: { id: null } }, res);
  return res;
}

test('F1: movimiento con fecha futura → 400; hoy y ayer sí', () => {
  const futuro = call(createMovement, { delta: 5, reason: 'ingreso', occurredAt: dia(1) });
  assert.equal(futuro.statusCode, 400);
  assert.match(futuro.body.error, /futura/);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n, 0);

  assert.equal(call(createMovement, { delta: 5, reason: 'ingreso', occurredAt: hoyLocal() }).statusCode, 201);
  assert.equal(call(createMovement, { delta: 5, reason: 'ingreso', occurredAt: dia(-1) }).statusCode, 201);
});

test('F2: tanda con fecha futura → 400 al crear y al editar', () => {
  assert.equal(call(createBatch, { quantity: 10, producedAt: dia(3) }).statusCode, 400);
  assert.equal(h.getStock(), 0);
  const ok = call(createBatch, { quantity: 10, producedAt: dia(-2) });
  assert.equal(ok.statusCode, 201);
  const edit = call(updateBatch, { producedAt: dia(1) }, { id: String(ok.body.batch.id) });
  assert.equal(edit.statusCode, 400);
});

test('F3: venta del panel con fecha futura → 400; con fecha pasada fecha su asiento', () => {
  h.addStock(20);
  const futura = h.manualSale({ quantityHallacas: 2, occurredAt: dia(1) });
  assert.equal(futura.statusCode, 400);
  assert.match(futura.body.error, /futura/);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);

  assert.equal(h.manualSale({ quantityHallacas: 2, occurredAt: '2026-13-01' }).statusCode, 400);

  const ayer = dia(-1);
  const res = h.manualSale({ quantityHallacas: 2, occurredAt: ayer });
  assert.equal(res.statusCode, 201);
  const asiento = h.db.prepare('SELECT occurred_at FROM stock_movements WHERE order_id = ?').get(res.body.order.id);
  assert.equal(asiento.occurred_at, ayer);

  // sin fecha: hoy
  const hoy = h.manualSale({ quantityHallacas: 1 }).body.order.id;
  assert.equal(h.db.prepare('SELECT occurred_at FROM stock_movements WHERE order_id = ?').get(hoy).occurred_at, hoyLocal());
});
