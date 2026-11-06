/**
 * STOCK FASE 2 (punto 4, A3): al cancelar un pedido ya entregado el admin
 * elige devolución (vuelve a stock) o merma (no vuelve).
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getStockBreakdown } = require('../controllers/packs.controller');
const { orderLedgerNet } = require('../services/ledger');

beforeEach(() => h.resetDb());

/** Confirmed, delivered sale of `qty` hallacas on a stock of 20. */
function delivered(qty = 5) {
  h.addStock(20);
  const id = h.manualSale({ quantityHallacas: qty, status: 'pagado' }).body.order.id;
  assert.equal(h.patch(id, { delivered: true }).statusCode, 200);
  assert.equal(h.getStock(), 20 - qty);
  return id;
}

const rows = (id) => h.db.prepare('SELECT kind, delta FROM stock_movements WHERE order_id = ? ORDER BY id').all(id)
  .map((r) => [r.kind, r.delta]);
const lastEvent = (id) => h.db.prepare('SELECT event, detail FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(id);

test('A3-1: cancelar un entregado sin decir qué pasó con las hallacas → 400 y nada cambia', () => {
  const id = delivered();
  const res = h.patch(id, { status: 'cancelado' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'MODO_CANCELACION_REQUERIDO');
  assert.equal(h.getOrder(id).status, 'pagado');
  assert.equal(h.getStock(), 15);
});

test('A3-2: devolución — las hallacas vuelven al stock', () => {
  const id = delivered();
  assert.equal(h.patch(id, { status: 'cancelado', cancelMode: 'devolucion' }).statusCode, 200);
  assert.equal(h.getStock(), 20);
  assert.deepEqual(rows(id), [['venta', -5], ['reverso', 5]]);
  assert.deepEqual(lastEvent(id), { event: 'cancelado', detail: 'devolucion' });
});

test('A3-3: merma — no vuelven; el asiento de merma cuenta como egreso', () => {
  const id = delivered();
  assert.equal(h.patch(id, { status: 'cancelado', cancelMode: 'merma' }).statusCode, 200);
  assert.equal(h.getStock(), 15);
  assert.deepEqual(rows(id), [['venta', -5], ['reverso', 5], ['merma', -5]]);
  assert.equal(orderLedgerNet(id), 0, 'la reserva quedó saldada; la merma va aparte');
  const b = getStockBreakdown();
  assert.equal(b.egresos, 5);
  assert.equal(b.comprometidas, 0);
  assert.deepEqual(lastEvent(id), { event: 'cancelado', detail: 'merma' });
});

test('A3-4: un cancelado como merma no se reactiva (409); uno devuelto sí', () => {
  const merma = delivered(3);
  h.patch(merma, { status: 'cancelado', cancelMode: 'merma' });
  const res = h.patch(merma, { status: 'pagado' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CANCELADO_COMO_MERMA');
  assert.equal(h.getOrder(merma).status, 'cancelado');

  h.resetDb();
  const dev = delivered(3);
  h.patch(dev, { status: 'cancelado', cancelMode: 'devolucion' });
  assert.equal(h.patch(dev, { status: 'pagado' }).statusCode, 200);
  assert.equal(h.getStock(), 17);
});

test('A3-5: cancelMode inválido o fuera de lugar → 400', () => {
  const id = delivered();
  assert.equal(h.patch(id, { status: 'cancelado', cancelMode: 'perdida' }).statusCode, 400);
  assert.equal(h.patch(id, { notes: 'x', cancelMode: 'merma' }).statusCode, 400);

  const noEntregado = h.manualSale({ quantityHallacas: 1 }).body.order.id;
  assert.equal(h.patch(noEntregado, { status: 'cancelado', cancelMode: 'merma' }).statusCode, 400);
  // un pedido no entregado se cancela como siempre, sin cancelMode
  assert.equal(h.patch(noEntregado, { status: 'cancelado' }).statusCode, 200);
});
