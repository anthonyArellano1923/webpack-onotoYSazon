/**
 * PLAN-11: web checkout — provisional hold (T1–T3), phone limit (T5), stock (T6)
 * and encargos (T7).
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { getAllOrders, getReports } = require('../controllers/admin.controller');
const { getKardex } = require('../controllers/stock.controller');
const { getMyOrders } = require('../controllers/orders.controller');
const { listPublicPacks } = require('../controllers/packs.controller');

const CONTACT = 'Para un pedido así, ponte en contacto directo con el vendedor.';

beforeEach(() => h.resetDb());

/** Returns the reports payload. */
function reports() {
  const res = h.mockRes();
  getReports({}, res);
  return res.body.reports;
}

/** Returns the admin order list entry for an id. */
function adminOrder(id) {
  const res = h.mockRes();
  getAllOrders({}, res);
  return res.body.orders.find((o) => o.id === id);
}

test('T1: pedido web reserva stock por 24 h sin confirmar', () => {
  h.addStock(50);
  const res = h.webOrder({ hallacas: 10 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.order.review, 'por_confirmar');
  assert.equal(res.body.holdHours, 24);
  assert.match(res.body.message, /24 h/);

  const row = h.getOrder(res.body.order.id);
  assert.equal(row.confirmed_at, null);
  const expires = new Date(`${row.expires_at.replace(' ', 'T')}Z`).getTime();
  const expected = Date.now() + 24 * 3600 * 1000;
  assert.ok(Math.abs(expires - expected) <= 60 * 1000, `expires_at fuera de ±1 min: ${row.expires_at}`);
  assert.equal(h.getStock(), 40);
});

test('T2: al vencer libera stock y sale de kardex y reportes', () => {
  h.addStock(50);
  const { body } = h.webOrder({ hallacas: 10 });
  h.expire(body.order.id);

  assert.equal(h.getStock(), 50);

  const kardex = h.mockRes();
  getKardex({}, kardex);
  // STOCK FASE 2: el kardex es el ledger; el vencido muestra su venta y su
  // reverso, que se compensan, y el saldo vuelve a 50.
  const lineas = kardex.body.movimientos.filter((m) => m.order_id === body.order.id);
  assert.deepEqual(lineas.map((m) => m.kind).sort(), ['reverso', 'venta']);
  assert.equal(lineas.reduce((sum, m) => sum + m.delta, 0), 0);
  assert.equal(kardex.body.movimientos[0].saldo, 50);

  const r = reports();
  assert.equal(r.hallacas_vendidas, 0);
  assert.equal(r.stock, 50);
  assert.deepEqual(r.vencidos, { n: 1, hallacas: 10 });
  assert.deepEqual(r.por_confirmar, { n: 0, hallacas: 0 });
  assert.equal(r.ventas_por_estado.vencidos, 1);

  assert.equal(adminOrder(body.order.id).review, 'vencido');
});

test('T3: confirmar un por_confirmar fija confirmed_at y ya no vence', () => {
  h.addStock(50);
  const { body } = h.webOrder({ hallacas: 10 });
  const id = body.order.id;
  assert.equal(reports().por_confirmar.n, 1);

  const res = h.patch(id, { confirm: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.review, 'confirmado');
  assert.notEqual(h.getOrder(id).confirmed_at, null);
  assert.equal(h.getStock(), 40);

  h.expire(id);
  assert.equal(h.getStock(), 40);
  assert.equal(adminOrder(id).review, 'confirmado');
});

test('T5a: teléfono con 15 activas que pide 6 → 409 LIMITE_TELEFONO', () => {
  h.addStock(100);
  assert.equal(h.webOrder({ hallacas: 15 }).statusCode, 201);
  const res = h.webOrder({ hallacas: 6 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'LIMITE_TELEFONO');
  assert.equal(res.body.error, CONTACT);
});

test('T5b: teléfono con 15 activas que pide 5 → 201', () => {
  h.addStock(100);
  h.webOrder({ hallacas: 15 });
  assert.equal(h.webOrder({ hallacas: 5 }).statusCode, 201);
});

test('T5c: cancelados, vencidos y entregados del mismo teléfono no cuentan', () => {
  h.addStock(200);
  const cancelado = h.webOrder({ hallacas: 20 }).body.order.id;
  assert.equal(h.patch(cancelado, { status: 'cancelado' }).statusCode, 200);

  const vencido = h.webOrder({ hallacas: 20 }).body.order.id;
  h.expire(vencido);

  const entregado = h.webOrder({ hallacas: 20 }).body.order.id;
  assert.equal(h.patch(entregado, { confirm: true, delivered: true }).statusCode, 200);

  assert.equal(h.webOrder({ hallacas: 20 }).statusCode, 201);
});

test('T5d: 912345678, +56912345678 y 9 1234 5678 son el mismo teléfono', () => {
  h.addStock(100);
  assert.equal(h.webOrder({ phone: '912345678', hallacas: 15 }).statusCode, 201);
  assert.equal(h.webOrder({ phone: '+56912345678', hallacas: 6 }).body.code, 'LIMITE_TELEFONO');
  assert.equal(h.webOrder({ phone: '9 1234 5678', hallacas: 6 }).body.code, 'LIMITE_TELEFONO');
  assert.equal(h.webOrder({ phone: '9 1234 5678', hallacas: 5 }).statusCode, 201);
});

test('T5e: usuario logueado suma también por user_id con otro teléfono', () => {
  h.addStock(100);
  const user = h.createUser('+56987654321');
  assert.equal(h.webOrder({ phone: '987654321', hallacas: 15, user }).statusCode, 201);

  const otro = h.webOrder({ phone: '933333333', hallacas: 6, user });
  assert.equal(otro.statusCode, 409);
  assert.equal(otro.body.code, 'LIMITE_TELEFONO');

  assert.equal(h.webOrder({ phone: '933333333', hallacas: 5, user }).statusCode, 201);
  // Mismo límite de 20 que sin cuenta: ya suma 20 entre los dos teléfonos.
  assert.equal(h.webOrder({ phone: '944444444', hallacas: 1, user }).body.code, 'LIMITE_TELEFONO');
});

test('T5f: ventas manuales del mismo teléfono no cuentan', () => {
  h.addStock(100);
  assert.equal(h.manualSale({ customerPhone: '912345678', quantityHallacas: 20 }).statusCode, 201);
  assert.equal(h.webOrder({ phone: '912345678', hallacas: 20 }).statusCode, 201);
});

test('T6: pedir más que el stock → 409 SIN_STOCK con el texto de D9', () => {
  h.addStock(5);
  const res = h.webOrder({ hallacas: 6 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'SIN_STOCK');
  assert.equal(res.body.error, CONTACT);
  assert.equal(h.getStock(), 5);
});

test('T7: encargo pXL respeta el límite y no mueve el stock', () => {
  h.addStock(10);
  const items = [{ packId: 'pXL', qty: 1 }];
  const excede = h.webOrder({ items, quantityHallacas: 21 });
  assert.equal(excede.statusCode, 409);
  assert.equal(excede.body.code, 'LIMITE_TELEFONO');

  const ok = h.webOrder({ items, quantityHallacas: 20 });
  assert.equal(ok.statusCode, 201);
  assert.equal(h.getOrder(ok.body.order.id).stock_exempt, 1);
  assert.equal(h.getStock(), 10);
});

test('getMyOrders y /packs exponen el contrato nuevo', () => {
  h.addStock(50);
  const user = h.createUser('+56987654321');
  h.webOrder({ phone: '987654321', hallacas: 3, user });

  const mine = h.mockRes();
  getMyOrders({ user }, mine);
  const o = mine.body.orders[0];
  assert.equal(o.quantity_hallacas, 3);
  assert.equal(o.review, 'por_confirmar');
  assert.equal(o.confirmed_at, null);
  assert.ok(o.expires_at);

  const packs = h.mockRes();
  listPublicPacks({}, packs);
  assert.deepEqual(packs.body.limits, { maxHallacasPorTelefono: 20, holdHours: 24 });
  assert.equal(packs.body.stock_available, 47);
});
