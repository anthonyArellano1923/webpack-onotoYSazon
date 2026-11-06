/**
 * PLAN-11: migration addOrdersReviewColumns (T12). Each case builds its own
 * in-memory database and reproduces db.js's startup path: exec(schema.sql)
 * first, then runMigrations — that order is what would expose an index on a
 * column that does not exist yet.
 */
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations, withTableSwap } = require('../database/migrate');
const { getStock } = require('../controllers/packs.controller');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
const NEW_COLUMNS = ['confirmed_at', 'expires_at', 'reminder_sent_at', 'expired_notified_at'];

// Las migraciones loguean cada paso: silenciarlas deja legible la salida.
console.log = () => {};

/**
 * Opens a fresh in-memory DB with the same pragmas as db.js.
 * @returns {import('better-sqlite3').Database}
 */
function openDb() {
  const conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  return conn;
}

/**
 * Runs the real startup path of db.js on a connection.
 * @param {import('better-sqlite3').Database} conn
 */
function startup(conn) {
  conn.exec(SCHEMA);
  runMigrations(conn);
}

/** Schema as it was before PLAN-11: schema.sql without the four new columns. */
const PRE_PLAN11_SCHEMA = SCHEMA
  .split('\n')
  .filter((line) => !NEW_COLUMNS.some((c) => new RegExp(`^\\s*${c}\\s`).test(line)))
  .join('\n');

/**
 * Stock with the ADR-3 formula (pre PLAN-11), for the "before" snapshot.
 * @param {import('better-sqlite3').Database} conn
 * @returns {number}
 */
function legacyStock(conn) {
  const mov = conn.prepare('SELECT COALESCE(SUM(delta),0) AS n FROM stock_movements').get().n;
  const comp = conn.prepare(
    "SELECT COALESCE(SUM(quantity_hallacas),0) AS n FROM orders WHERE status != 'cancelado' AND stock_exempt = 0"
  ).get().n;
  return mov - comp;
}

/**
 * Builds a pre-PLAN-11 database with 3 orders (one exempt) and +50 stock.
 * @returns {import('better-sqlite3').Database}
 */
function legacyDb() {
  const conn = openDb();
  conn.exec(PRE_PLAN11_SCHEMA);
  const cols = conn.prepare("PRAGMA table_info('orders')").all().map((c) => c.name);
  assert.ok(!cols.includes('confirmed_at'), 'el esquema de partida no debe tener las columnas nuevas');
  conn.prepare("INSERT INTO stock_movements (delta, reason) VALUES (50, 'saldo inicial')").run();
  const insert = conn.prepare(`
    INSERT INTO orders (customer_name, customer_phone, quantity_hallacas, source, stock_exempt, created_at)
    VALUES (?, '+56912345678', ?, 'web', ?, ?)
  `);
  insert.run('Uno', 10, 0, '2026-10-01 12:00:00');
  insert.run('Dos', 5, 0, '2026-10-02 12:00:00');
  insert.run('Tres', 20, 1, '2026-10-03 12:00:00');
  return conn;
}

test('T12a: migración de esquema anterior confirma los pedidos legados y conserva el stock', () => {
  const conn = legacyDb();
  const before = legacyStock(conn);

  startup(conn);

  const cols = conn.prepare("PRAGMA table_info('orders')").all().map((c) => c.name);
  for (const c of NEW_COLUMNS) assert.ok(cols.includes(c), `falta ${c}`);

  const rows = conn.prepare('SELECT * FROM orders ORDER BY id').all();
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(r.confirmed_at, r.created_at);
  assert.deepEqual(rows.map((r) => r.stock_exempt), [0, 0, 1]);
  assert.equal(getStock(conn), before);
  assert.equal(before, 35);

  const indexes = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
  for (const i of ['idx_orders_phone', 'idx_orders_review', 'idx_order_items_order']) {
    assert.ok(indexes.includes(i), `falta índice ${i}`);
  }
});

test('T12b: un pedido web nuevo sigue sin confirmar tras otra corrida de migraciones', () => {
  const conn = legacyDb();
  startup(conn);
  const id = conn.prepare(`
    INSERT INTO orders (customer_name, customer_phone, quantity_hallacas, source, confirmed_at, expires_at)
    VALUES ('Nuevo', '+56912345678', 3, 'web', NULL, datetime('now', '+24 hours'))
  `).run().lastInsertRowid;

  startup(conn);

  assert.equal(conn.prepare('SELECT confirmed_at FROM orders WHERE id = ?').get(id).confirmed_at, null);
});

test('T12c: withTableSwap deja foreign_keys en ON aunque la función lance', () => {
  const conn = openDb();
  assert.throws(() => withTableSwap(conn, () => { throw new Error('falla a propósito'); }), /falla a propósito/);
  assert.equal(conn.pragma('foreign_keys', { simple: true }), 1);
});

test('T12d: BD muy vieja (entregado en el CHECK, orders vacía) termina con todas las columnas', () => {
  const conn = openDb();
  conn.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT UNIQUE,
      password_hash TEXT NOT NULL, address TEXT,
      role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE orders (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      customer_name     TEXT NOT NULL DEFAULT '',
      customer_phone    TEXT,
      status            TEXT NOT NULL DEFAULT 'pendiente_pago'
                          CHECK(status IN ('pagado','pendiente_pago','pendiente_entrega','entregado','cortesia','cancelado')),
      delivery          TEXT NOT NULL DEFAULT 'retiro' CHECK(delivery IN ('retiro', 'despacho')),
      address           TEXT,
      date_hint         TEXT,
      notes             TEXT,
      total_clp         INTEGER,
      quantity_hallacas INTEGER NOT NULL DEFAULT 0,
      payment_method    TEXT,
      source            TEXT NOT NULL DEFAULT 'web',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  startup(conn);

  const sql = conn.prepare("SELECT sql FROM sqlite_master WHERE name = 'orders'").get().sql;
  assert.ok(!sql.includes('entregado'), 'el swap final debió quitar entregado del CHECK');
  const cols = conn.prepare("PRAGMA table_info('orders')").all().map((c) => c.name);
  for (const c of ['stock_exempt', 'delivered_at', 'batch_id', ...NEW_COLUMNS]) {
    assert.ok(cols.includes(c), `falta ${c}`);
  }
  assert.equal(conn.pragma('foreign_keys', { simple: true }), 1);
});
