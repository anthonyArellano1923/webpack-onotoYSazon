/**
 * STOCK FASE 2: migración sobre una BD real de PLAN-13 (esquema congelado en
 * test/fixtures/schema-plan13.sql, sin deleted_at, order_id ni order_events).
 * Reproduce el arranque de db.js: exec(schema.sql actual) y luego
 * runMigrations, dos veces.
 */
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../database/migrate');
const { getStock } = require('../controllers/packs.controller');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
const PLAN13 = fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-plan13.sql'), 'utf8');
const OLD_LIVE = "status != 'cancelado' AND (confirmed_at IS NOT NULL OR expires_at > datetime('now'))";

/** Startup path of db.js. */
function startup(conn) {
  conn.exec(SCHEMA);
  runMigrations(conn);
}

/** Snapshot of everything the migration must not lose or duplicate. */
function snapshot(conn) {
  return {
    movements: conn.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n,
    events: conn.prepare('SELECT COUNT(*) AS n FROM order_events').get().n,
    orders: conn.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    items: conn.prepare('SELECT COUNT(*) AS n FROM order_items').get().n,
  };
}

test('M1: BD de PLAN-13 con datos → stock igual, ids y contador intactos, historia sembrada, idempotente', () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    const conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    conn.exec(PLAN13);
    const cols = (t) => conn.prepare(`PRAGMA table_info('${t}')`).all().map((c) => c.name);
    assert.ok(!cols('orders').includes('deleted_at'));
    assert.ok(!cols('stock_movements').includes('order_id'));
    assert.equal(conn.prepare("SELECT name FROM sqlite_master WHERE name = 'order_events'").get(), undefined);

    // Movimientos: ajuste, tanda, y uno borrado (contador en 3).
    conn.prepare("INSERT INTO stock_movements (id, delta, reason, occurred_at) VALUES (1, 100, 'saldo inicial', '2026-10-01')").run();
    conn.prepare("INSERT INTO stock_movements (id, delta, reason, kind, batch_ref, occurred_at) VALUES (2, 40, 'Ingreso por tanda', 'tanda', 1, '2026-10-02')").run();
    conn.prepare("INSERT INTO stock_movements (id, delta, reason) VALUES (3, -2, 'rota')").run();
    conn.prepare('DELETE FROM stock_movements WHERE id = 3').run();

    const ins = conn.prepare(`
      INSERT INTO orders (customer_name, quantity_hallacas, source, status, stock_exempt,
                          confirmed_at, expires_at, delivered_at, created_at, updated_at)
      VALUES (@name, @qty, @source, @status, @exempt, @confirmed, @expires, @delivered, @created, @updated)
    `);
    const base = { exempt: 0, confirmed: null, expires: null, delivered: null, updated: '2026-10-06 12:00:00' };
    const entregada = ins.run({ ...base, name: 'Entregada', qty: 10, source: 'admin', status: 'pagado', confirmed: '2026-10-03 12:00:00', delivered: '2026-10-04 12:00:00', created: '2026-10-03 12:00:00' }).lastInsertRowid;
    const cancelada = ins.run({ ...base, name: 'Cancelada', qty: 6, source: 'web', status: 'cancelado', expires: '2026-10-04 12:00:00', created: '2026-10-03 12:00:00' }).lastInsertRowid;
    const vencida = ins.run({ ...base, name: 'Vencida', qty: 3, source: 'web', status: 'pendiente_pago', expires: '2026-10-05 12:00:00', created: '2026-10-04 12:00:00' }).lastInsertRowid;
    const encargo = ins.run({ ...base, name: 'Encargo', qty: 20, source: 'admin', status: 'pendiente_pago', exempt: 1, confirmed: '2026-10-05 12:00:00', created: '2026-10-05 12:00:00' }).lastInsertRowid;
    const porConfirmar = ins.run({ ...base, name: 'Por confirmar', qty: 4, source: 'web', status: 'pendiente_pago', expires: '2099-01-01 00:00:00', created: '2026-10-06 12:00:00' }).lastInsertRowid;
    conn.prepare("INSERT INTO order_items (order_id, pack_id, pack_name, qty, price_at_time_clp) VALUES (?, 'p4', 'Cena íntima', 1, 13000)").run(porConfirmar);

    const before = conn.prepare('SELECT SUM(delta) AS n FROM stock_movements').get().n
      - conn.prepare(`SELECT SUM(quantity_hallacas) AS n FROM orders WHERE ${OLD_LIVE} AND stock_exempt = 0`).get().n;
    assert.equal(before, 140 - 10 - 4);

    startup(conn);
    const first = snapshot(conn);
    startup(conn);
    assert.deepEqual(snapshot(conn), first, 'la segunda corrida no agrega ni quita nada');

    // Columnas y tablas nuevas
    assert.ok(cols('orders').includes('deleted_at'));
    assert.ok(cols('stock_movements').includes('order_id'));

    // Stock idéntico y el ledger cuadra con él
    assert.equal(getStock(conn), before);
    assert.equal(conn.prepare('SELECT SUM(delta) AS n FROM stock_movements').get().n, before, 'saldo del kardex = stock');

    // Movimientos viejos con sus ids; el id 3 no se reutiliza
    const mov = conn.prepare('SELECT id, kind, delta, order_id, occurred_at, created_at FROM stock_movements ORDER BY id').all();
    assert.deepEqual(mov.slice(0, 2).map((m) => [m.id, m.kind, m.delta, m.order_id]), [[1, 'ajuste', 100, null], [2, 'tanda', 40, null]]);
    const ventas = mov.slice(2);
    assert.ok(ventas.every((m) => m.id > 3 && m.kind === 'venta'));
    assert.deepEqual(ventas.map((m) => [m.order_id, m.delta]), [[entregada, -10], [porConfirmar, -4]]);
    assert.equal(ventas[0].created_at, '2026-10-03 12:00:00');

    // Bitácora histórica
    const ev = (id) => conn.prepare('SELECT event FROM order_events WHERE order_id = ? ORDER BY id').all(id).map((e) => e.event);
    assert.deepEqual(ev(entregada), ['creado', 'entregado']);
    assert.deepEqual(ev(cancelada), ['creado', 'rechazado']);
    assert.deepEqual(ev(vencida), ['creado']);
    assert.deepEqual(ev(encargo), ['creado']);
    assert.deepEqual(ev(porConfirmar), ['creado']);

    // Nada perdido, integridad referencial sana
    assert.equal(first.orders, 5);
    assert.equal(first.items, 1);
    assert.deepEqual(conn.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(conn.pragma('foreign_keys', { simple: true }), 1);
    const idx = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
    for (const i of ['idx_stock_movements_fecha', 'idx_stock_movements_created_by', 'idx_stock_movements_order', 'idx_order_events_order']) {
      assert.ok(idx.includes(i), `falta índice ${i}`);
    }
  } finally {
    console.log = realLog;
  }
});

test('M2: contador de stock_movements con la tabla vacía se conserva', () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    const conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    conn.exec(PLAN13);
    conn.prepare("INSERT INTO stock_movements (delta, reason) VALUES (5, 'x x x')").run();
    conn.prepare("INSERT INTO stock_movements (delta, reason) VALUES (5, 'x x x')").run();
    conn.prepare('DELETE FROM stock_movements').run();
    startup(conn);
    const id = conn.prepare("INSERT INTO stock_movements (delta, reason) VALUES (1, 'nuevo')").run().lastInsertRowid;
    assert.equal(id, 3);
  } finally {
    console.log = realLog;
  }
});
