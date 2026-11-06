/**
 * STOCK FASE 2 (punto 3): borrar un pedido marca deleted_at y deja un asiento
 * de reverso; no se pierde historia.
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { deleteOrder, getAllOrders, getReports, getOrderEvents } = require('../controllers/admin.controller');
const { getMyOrders } = require('../controllers/orders.controller');
const { orderLedgerNet } = require('../services/ledger');
const { sweepOnce } = require('../services/notify');

beforeEach(() => h.resetDb());

/** Calls DELETE /admin/orders/:id. */
function del(id) {
  const res = h.mockRes();
  deleteOrder({ params: { id: String(id) } }, res);
  return res;
}

/** Ledger rows of an order. */
const rows = (id) => h.db.prepare('SELECT kind, delta, reason, occurred_at FROM stock_movements WHERE order_id = ? ORDER BY id').all(id);
/** Event names of an order. */
const events = (id) => h.db.prepare('SELECT event FROM order_events WHERE order_id = ? ORDER BY id').all(id).map((e) => e.event);

test('S1: borrar conserva fila, ítems, asientos y eventos; libera la reserva con un reverso', () => {
  h.addStock(30);
  const user = h.createUser();
  const id = h.webOrder({ hallacas: 6, user }).body.order.id;
  h.patch(id, { confirm: true });
  assert.equal(h.getStock(), 24);

  assert.equal(del(id).statusCode, 200);

  const row = h.getOrder(id);
  assert.ok(row, 'la fila sigue en la BD');
  assert.notEqual(row.deleted_at, null);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(id).n, 1);
  assert.equal(h.getStock(), 30);
  assert.deepEqual(rows(id).map((r) => [r.kind, r.delta]), [['venta', -6], ['reverso', 6]]);
  assert.match(rows(id)[1].reason, /Eliminación del pedido/);
  assert.equal(orderLedgerNet(id), 0);
  assert.deepEqual(events(id), ['creado', 'confirmado', 'eliminado']);

  // Fuera del panel, reportes y "mis pedidos"; la bitácora sigue accesible.
  const list = h.mockRes();
  getAllOrders({}, list);
  assert.equal(list.body.orders.length, 0);
  const rep = h.mockRes();
  getReports({}, rep);
  assert.equal(rep.body.reports.ventas_por_estado.pendiente_pago, undefined);
  const mine = h.mockRes();
  getMyOrders({ user }, mine);
  assert.equal(mine.body.orders.length, 0);
  const ev = h.mockRes();
  getOrderEvents({ params: { id: String(id) } }, ev);
  assert.equal(ev.body.events.at(-1).event, 'eliminado');
});

test('S2: un borrado no se repite ni se puede editar después (404)', () => {
  h.addStock(30);
  const id = h.manualSale({ quantityHallacas: 2 }).body.order.id;
  assert.equal(del(id).statusCode, 200);
  assert.equal(del(id).statusCode, 404);
  assert.equal(h.patch(id, { status: 'pagado' }).statusCode, 404);
  assert.equal(rows(id).length, 2, 'sin asientos extra');
  assert.equal(h.getStock(), 30);
});

test('S3: borrar un pedido vencido sin barrido: el reverso va con la fecha del vencimiento', () => {
  h.addStock(30);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  h.db.prepare("UPDATE orders SET expires_at = '2026-11-01 12:00:00' WHERE id = ?").run(id);
  del(id);
  assert.deepEqual(rows(id).map((r) => r.kind), ['venta', 'reverso']);
  assert.match(rows(id)[1].reason, /Vencimiento/);
  assert.deepEqual(events(id), ['creado', 'expirado', 'eliminado']);
});

test('S4: borrar un cancelado no escribe asiento (ya no reservaba)', () => {
  h.addStock(30);
  const id = h.manualSale({ quantityHallacas: 2 }).body.order.id;
  h.patch(id, { status: 'cancelado' });
  const n = rows(id).length;
  del(id);
  assert.equal(rows(id).length, n);
  assert.equal(h.getStock(), 30);
});

test('S5: el barrido de avisos ignora los pedidos borrados', async () => {
  h.addStock(30);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  del(id);
  h.expire(id);
  await sweepOnce();
  assert.equal(h.getOrder(id).expired_notified_at, null);
  assert.ok(!events(id).includes('expirado'));
});
