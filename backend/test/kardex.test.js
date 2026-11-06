/**
 * STOCK FASE 2 (punto 6): el kardex muestra cada asiento con la fecha real del
 * movimiento, y su saldo final coincide siempre con getStock().
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getKardex } = require('../controllers/stock.controller');
const { deleteOrder } = require('../controllers/admin.controller');
const { hoyLocal } = require('../utils/fecha');

beforeEach(() => h.resetDb());

/** Kardex lines, newest first. */
function kardex() {
  const res = h.mockRes();
  getKardex({}, res);
  assert.equal(res.statusCode, 200);
  return res.body.movimientos;
}

/** Asserts the newest line's balance equals the stock. */
function assertSaldo() {
  const m = kardex();
  assert.equal(m.length ? m[0].saldo : 0, h.getStock());
}

test('K1: pedido reactivado aparece con la fecha de reactivación, no con la original', () => {
  h.addStock(30);
  const id = h.webOrder({ hallacas: 6 }).body.order.id;
  // El pedido es de hace 5 días y venció hace 4.
  h.db.prepare(`
    UPDATE orders SET created_at = datetime('now','-5 days'), expires_at = datetime('now','-4 days') WHERE id = ?
  `).run(id);
  h.db.prepare("UPDATE stock_movements SET occurred_at = date('now','localtime','-5 days'), created_at = datetime('now','-5 days') WHERE order_id = ?").run(id);

  h.patch(id, { confirm: true });

  const lineas = kardex().filter((m) => m.order_id === id);
  const fechas = (k) => lineas.filter((m) => m.kind === k).map((m) => m.fecha);
  const original = h.db.prepare("SELECT date('now','localtime','-5 days') AS d").get().d;
  const vencio = h.db.prepare("SELECT date(expires_at,'localtime') AS d FROM orders WHERE id = ?").get(id).d;
  assert.deepEqual(fechas('venta').sort(), [original, hoyLocal()].sort());
  assert.deepEqual(fechas('reverso'), [vencio]);
  assert.match(lineas.find((m) => m.fecha === hoyLocal()).motivo, /Reactivación/);
  assertSaldo();
});

test('K2: un vencido sin barrido ya aparece liberado y el saldo cuadra', () => {
  h.addStock(10);
  const id = h.webOrder({ hallacas: 4 }).body.order.id;
  // Creado hace 25 h, con su reserva de 24 h vencida hace 1 h.
  h.db.prepare("UPDATE orders SET created_at = datetime('now','-25 hours'), expires_at = datetime('now','-1 hours') WHERE id = ?").run(id);
  h.db.prepare("UPDATE stock_movements SET occurred_at = date('now','-25 hours','localtime'), created_at = datetime('now','-25 hours') WHERE order_id = ?").run(id);
  const lineas = kardex();
  const delPedido = lineas.filter((m) => m.order_id === id).map((m) => m.kind);
  assert.deepEqual(delPedido, ['reverso', 'venta'], 'más reciente primero');
  assert.equal(lineas[0].saldo, 10);
  assert.equal(h.getStock(), 10);
});

test('K3: cadena completa — el saldo del kardex = stock después de cada paso', () => {
  h.addStock(100);
  assertSaldo();
  const web = h.webOrder({ hallacas: 10 }).body.order.id; assertSaldo();
  h.expire(web); assertSaldo();
  h.patch(web, { confirm: true }); assertSaldo();
  h.patch(web, { status: 'cancelado' }); assertSaldo();
  h.patch(web, { status: 'pagado' }); assertSaldo();
  h.patch(web, { delivered: true }); assertSaldo();
  h.patch(web, { status: 'cancelado', cancelMode: 'merma' }); assertSaldo();
  assert.equal(h.getStock(), 90, 'la merma no devuelve las hallacas');

  const otra = h.manualSale({ quantityHallacas: 5 }).body.order.id; assertSaldo();
  const res = h.mockRes();
  deleteOrder({ params: { id: String(otra) } }, res); assertSaldo();

  const encargo = h.manualSale({ quantityHallacas: 8, encargo: true }).body.order.id; assertSaldo();
  h.patch(encargo, { confirmStock: true, quantityHallacas: 8, totalClp: 24000 }); assertSaldo();
  h.patch(encargo, { quantityHallacas: 3 }); assertSaldo();
  assert.equal(h.getStock(), 87);

  // Las líneas de pedidos no llevan papelera; los ajustes sí.
  const lineas = kardex();
  assert.ok(lineas.filter((m) => m.order_id !== null).every((m) => m.tipo === 'pedido'));
  assert.deepEqual(lineas.filter((m) => m.tipo === 'movimiento').map((m) => m.kind), ['ajuste']);
  assert.ok(lineas.some((m) => m.pedido_eliminado));
});

test('K4: venta del panel con fecha pasada se ubica en esa fecha', () => {
  h.addStock(10);
  const res = h.manualSale({ quantityHallacas: 2, occurredAt: '2026-01-15' });
  const linea = kardex().find((m) => m.order_id === res.body.order.id);
  assert.equal(linea.fecha, '2026-01-15');
  assertSaldo();
});
