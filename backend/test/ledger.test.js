/**
 * STOCK FASE 2 (punto 1): ventas, cancelaciones, confirmaciones y
 * reactivaciones dejan asientos en stock_movements, sin mover el número de
 * stock derivado (ADR-3).
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { LIVE_ORDER_SQL } = require('../utils/orderState');
const { materializeExpirations, orderLedgerNet } = require('../services/ledger');
const { deleteMovement } = require('../controllers/stock.controller');
const { deleteOrder } = require('../controllers/admin.controller');
const { sweepOnce } = require('../services/notify');
const { runMigrations } = require('../database/migrate');

beforeEach(() => h.resetDb());

/**
 * Stock with the pre-FASE-2 formula: every movement row minus live orders.
 * Only valid while no order rows exist; used to show the number did not move.
 * @returns {number}
 */
function manualMovementsMinusLive() {
  const mov = h.db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM stock_movements WHERE order_id IS NULL AND kind IN ('ajuste','tanda')").get().n;
  const live = h.db.prepare(`SELECT COALESCE(SUM(quantity_hallacas),0) AS n FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 0`).get().n;
  return mov - live;
}

/** Ledger rows of an order, oldest first. */
function rows(orderId) {
  return h.db.prepare('SELECT * FROM stock_movements WHERE order_id = ? ORDER BY id').all(orderId);
}

/**
 * Asserts that every order's ledger net equals minus its current reservation
 * and that the stock equals the derived formula.
 */
function assertReconciled() {
  materializeExpirations();
  const orders = h.db.prepare(`
    SELECT id, quantity_hallacas, stock_exempt, (${LIVE_ORDER_SQL}) AS live FROM orders
  `).all();
  for (const o of orders) {
    const target = o.live && o.stock_exempt === 0 ? o.quantity_hallacas : 0;
    assert.equal(orderLedgerNet(o.id) + target, 0, `ledger del pedido #${o.id}`);
  }
  assert.equal(h.getStock(), manualMovementsMinusLive());
}

test('L1: cadena completa — cada transición deja su asiento y el stock no cambia de fórmula', () => {
  h.addStock(100);

  // 1. pedido web: reserva
  const id = h.webOrder({ hallacas: 10 }).body.order.id;
  assert.deepEqual(rows(id).map((r) => [r.kind, r.delta]), [['venta', -10]]);
  assert.equal(h.getStock(), 90);
  assertReconciled();

  // 2. vence sin que nadie lo note → el reverso queda con la fecha del vencimiento
  h.db.prepare("UPDATE orders SET expires_at = '2026-11-01 03:30:00' WHERE id = ?").run(id);
  assert.equal(h.getStock(), 100, 'el stock se libera al instante, sin asiento');
  materializeExpirations();
  const venc = rows(id).at(-1);
  assert.equal(venc.kind, 'reverso');
  assert.equal(venc.delta, 10);
  assert.equal(venc.created_at, '2026-11-01 03:30:00');
  assert.equal(venc.occurred_at, h.db.prepare("SELECT date('2026-11-01 03:30:00','localtime') AS d").get().d);
  assert.match(venc.reason, /Vencimiento/);
  assertReconciled();

  // 3. confirmado tarde → reactivación
  assert.equal(h.patch(id, { confirm: true }).statusCode, 200);
  const react = rows(id).at(-1);
  assert.deepEqual([react.kind, react.delta], ['venta', -10]);
  assert.match(react.reason, /Reactivación/);
  assert.equal(h.getStock(), 90);
  assertReconciled();

  // 4. cantidad: sube y baja
  h.patch(id, { quantityHallacas: 12 });
  assert.deepEqual([rows(id).at(-1).kind, rows(id).at(-1).delta], ['venta', -2]);
  h.patch(id, { quantityHallacas: 7 });
  assert.deepEqual([rows(id).at(-1).kind, rows(id).at(-1).delta], ['reverso', 5]);
  assertReconciled();

  // 5. cancelado → reverso; reactivado → venta
  h.patch(id, { status: 'cancelado' });
  assert.deepEqual([rows(id).at(-1).kind, rows(id).at(-1).delta], ['reverso', 7]);
  assert.equal(h.getStock(), 100);
  h.patch(id, { status: 'pagado' });
  assert.deepEqual([rows(id).at(-1).kind, rows(id).at(-1).delta], ['venta', -7]);
  assert.equal(h.getStock(), 93);
  assertReconciled();

  // 6. pagado y entregado no reservan de nuevo
  const n = rows(id).length;
  h.patch(id, { delivered: true });
  assert.equal(rows(id).length, n);
  assertReconciled();
});

test('L2: confirmar un vencido sin barrido previo escribe reverso y venta (no descuenta dos veces)', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 10 }).body.order.id;
  h.expire(id);
  h.patch(id, { confirm: true });
  assert.deepEqual(rows(id).map((r) => [r.kind, r.delta]), [['venta', -10], ['reverso', 10], ['venta', -10]]);
  assert.equal(orderLedgerNet(id), -10);
  assertReconciled();
});

test('L3: venta manual y encargo — el encargo no escribe hasta concretarse', () => {
  h.addStock(50);
  const venta = h.manualSale({ quantityHallacas: 5, status: 'pagado' }).body.order.id;
  assert.deepEqual(rows(venta).map((r) => [r.kind, r.delta]), [['venta', -5]]);

  const encargo = h.manualSale({ quantityHallacas: 20, encargo: true }).body.order.id;
  assert.equal(rows(encargo).length, 0);
  h.patch(encargo, { confirmStock: true, quantityHallacas: 15, totalClp: 45000 });
  assert.deepEqual(rows(encargo).map((r) => [r.kind, r.delta]), [['venta', -15]]);
  assert.equal(h.getStock(), 30);
  assertReconciled();
});

test('L4: el barrido de avisos registra el vencimiento aunque Telegram no esté configurado', async () => {
  h.addStock(20);
  const id = h.webOrder({ hallacas: 4 }).body.order.id;
  h.expire(id);
  await sweepOnce();
  assert.equal(orderLedgerNet(id), 0);
  assert.equal(rows(id).at(-1).kind, 'reverso');
  // segunda pasada: nada nuevo
  await sweepOnce();
  assert.equal(rows(id).length, 2);
});

test('L5: los asientos de pedidos no se pueden borrar desde el kardex', () => {
  h.addStock(20);
  const id = h.webOrder({ hallacas: 4 }).body.order.id;
  const res = h.mockRes();
  deleteMovement({ params: { id: String(rows(id)[0].id) } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(rows(id).length, 1);
});

test('L6: borrar un pedido deja el reverso de su reserva', () => {
  h.addStock(20);
  const id = h.webOrder({ hallacas: 4 }).body.order.id;
  const res = h.mockRes();
  deleteOrder({ params: { id: String(id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(h.getStock(), 20);
  const sum = h.db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM stock_movements WHERE kind IN ('venta','reverso')").get().n;
  assert.equal(sum, 0, 'la reserva y su reverso se compensan');
});

/* ------------------------------ Migración ------------------------------ */

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');

/** schema.sql with stock_movements as it was before STOCK FASE 2. */
function preFase2Schema() {
  const start = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS stock_movements');
  const end = SCHEMA.indexOf(');', start) + 2;
  const old = `CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL DEFAULT (date('now','localtime')),
  delta       INTEGER NOT NULL CHECK(delta <> 0),
  reason      TEXT    NOT NULL CHECK(length(trim(reason)) >= 3),
  kind        TEXT    NOT NULL DEFAULT 'ajuste' CHECK(kind IN ('ajuste','tanda')),
  batch_ref   INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);`;
  return SCHEMA.slice(0, start) + old + SCHEMA.slice(end);
}

test('L7: migración sobre BD con datos — ids, contador y stock intactos; idempotente', () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    const conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    conn.exec(preFase2Schema());
    // Estado de una BD previa: columnas de revisión ya agregadas por PLAN-11.
    runMigrationsWithoutLedger(conn);
    assert.ok(!conn.prepare("SELECT sql FROM sqlite_master WHERE name='stock_movements'").get().sql.includes('merma'));

    conn.prepare("INSERT INTO stock_movements (id, delta, reason) VALUES (1, 100, 'saldo inicial')").run();
    conn.prepare("INSERT INTO stock_movements (id, delta, reason, kind, batch_ref) VALUES (2, 30, 'tanda uno', 'tanda', 7)").run();
    conn.prepare("INSERT INTO stock_movements (id, delta, reason) VALUES (3, -1, 'rota')").run();
    conn.prepare('DELETE FROM stock_movements WHERE id = 3').run(); // contador en 3
    const ins = conn.prepare(`
      INSERT INTO orders (customer_name, quantity_hallacas, source, status, stock_exempt, confirmed_at, expires_at, created_at)
      VALUES (?, ?, 'web', ?, ?, ?, ?, ?)
    `);
    ins.run('Viva', 10, 'pagado', 0, '2026-10-01 15:00:00', null, '2026-10-01 15:00:00');
    ins.run('Cancelada', 5, 'cancelado', 0, '2026-10-02 15:00:00', null, '2026-10-02 15:00:00');
    ins.run('Encargo', 20, 'pendiente_pago', 1, '2026-10-03 15:00:00', null, '2026-10-03 15:00:00');
    ins.run('Vencida', 3, 'pendiente_pago', 0, null, '2026-10-04 15:00:00', '2026-10-03 15:00:00');
    ins.run('Por confirmar', 4, 'pendiente_pago', 0, null, "2099-01-01 00:00:00", '2026-10-05 15:00:00');

    const { getStock } = require('../controllers/packs.controller');
    const before = getStock(conn);
    assert.equal(before, 130 - 10 - 4);

    runMigrations(conn);
    runMigrations(conn);

    assert.equal(getStock(conn), before);
    const mov = conn.prepare('SELECT id, kind, delta, batch_ref, order_id, occurred_at, created_at FROM stock_movements ORDER BY id').all();
    assert.deepEqual(mov.slice(0, 2).map((m) => [m.id, m.kind, m.delta, m.batch_ref]), [[1, 'ajuste', 100, null], [2, 'tanda', 30, 7]]);
    const ventas = mov.filter((m) => m.kind === 'venta');
    assert.deepEqual(ventas.map((m) => [m.order_id, m.delta]), [[1, -10], [5, -4]], 'solo las reservas vivas');
    assert.ok(ventas.every((m) => m.id > 3), 'no reutiliza el id 3 borrado');
    assert.equal(ventas[0].created_at, '2026-10-01 15:00:00');
    const idx = conn.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stock_movements'").all().map((i) => i.name);
    for (const i of ['idx_stock_movements_fecha', 'idx_stock_movements_created_by', 'idx_stock_movements_order']) assert.ok(idx.includes(i), i);
    assert.equal(conn.pragma('foreign_keys', { simple: true }), 1);
  } finally {
    console.log = realLog;
  }
});

/**
 * Runs the migrations a pre-FASE-2 server would have run: everything except
 * the ledger swap (which is detected by its CHECK, so we restore the old table
 * shape by running only the PLAN-11 parts).
 * @param {import('better-sqlite3').Database} conn
 */
function runMigrationsWithoutLedger(conn) {
  const { addOrdersReviewColumns } = require('../database/migrate');
  addOrdersReviewColumns(conn);
}
