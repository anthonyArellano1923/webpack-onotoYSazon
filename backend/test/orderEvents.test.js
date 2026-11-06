/**
 * STOCK FASE 2 (punto 2): order_events registra cada cambio de estado del
 * pedido con su fecha y actor.
 */
const h = require('./helpers');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { materializeExpirations } = require('../services/ledger');
const { getOrderEvents } = require('../controllers/admin.controller');
const { updateSale } = require('../services/orders.service');
const { runMigrations } = require('../database/migrate');

beforeEach(() => h.resetDb());

/** [event, actor] pairs of an order, oldest first. */
function events(id) {
  return h.db.prepare('SELECT event, actor FROM order_events WHERE order_id = ? ORDER BY id').all(id)
    .map((e) => [e.event, e.actor]);
}

test('E1: web → vence → se confirma tarde → pagado → entregado', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  assert.deepEqual(events(id), [['creado', 'sistema']]);

  h.db.prepare("UPDATE orders SET expires_at = '2026-11-02 10:00:00' WHERE id = ?").run(id);
  materializeExpirations();
  materializeExpirations();
  assert.deepEqual(events(id).at(-1), ['expirado', 'sistema']);
  assert.equal(events(id).filter(([e]) => e === 'expirado').length, 1, 'una sola vez');
  const venc = h.db.prepare("SELECT occurred_at FROM order_events WHERE order_id = ? AND event = 'expirado'").get(id);
  assert.equal(venc.occurred_at, '2026-11-02 10:00:00', 'fecha del vencimiento real');

  h.patch(id, { confirm: true });
  h.patch(id, { status: 'pagado' });
  h.patch(id, { delivered: true });
  assert.deepEqual(events(id), [
    ['creado', 'sistema'], ['expirado', 'sistema'],
    ['reactivado', 'admin'], ['confirmado', 'admin'],
    ['pagado', 'admin'], ['entregado', 'admin'],
  ]);
});

test('E2: vencido sin barrido y confirmado: el evento expirado se escribe antes de la reactivación', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  h.expire(id);
  h.patch(id, { confirm: true, status: 'pagado' });
  assert.deepEqual(events(id), [
    ['creado', 'sistema'], ['expirado', 'sistema'], ['reactivado', 'admin'], ['confirmado', 'admin'], ['pagado', 'admin'],
  ]);
});

test('E3: rechazado (sin confirmar) vs cancelado (confirmado) y reactivado desde cancelado', () => {
  h.addStock(50);
  const web = h.webOrder({ hallacas: 5 }).body.order.id;
  h.patch(web, { status: 'cancelado' });
  assert.deepEqual(events(web).at(-1), ['rechazado', 'admin']);

  const venta = h.manualSale({ quantityHallacas: 3, status: 'pagado' }).body.order.id;
  assert.deepEqual(events(venta), [['creado', 'admin'], ['pagado', 'admin']]);
  h.patch(venta, { status: 'cancelado' });
  h.patch(venta, { status: 'pendiente_pago' });
  assert.deepEqual(events(venta).slice(2), [['cancelado', 'admin'], ['reactivado', 'admin']]);
});

test('E4: el actor telegram queda registrado y un PATCH sin cambios de estado no escribe eventos', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  updateSale(id, { confirm: true }, { actor: 'telegram' });
  assert.deepEqual(events(id).at(-1), ['confirmado', 'telegram']);
  h.patch(id, { notes: 'sin cebolla' });
  assert.equal(events(id).length, 2);
  // un error de negocio no deja eventos sueltos
  assert.throws(() => updateSale(id, { delivered: 'si' }, { actor: 'telegram' }));
  assert.equal(events(id).length, 2);
});

test('E5: GET /admin/orders/:id/events devuelve la bitácora con fechas', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  h.patch(id, { confirm: true });
  const res = h.mockRes();
  getOrderEvents({ params: { id: String(id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.events.map((e) => e.event), ['creado', 'confirmado']);
  assert.ok(res.body.events.every((e) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(e.occurred_at)));

  const missing = h.mockRes();
  getOrderEvents({ params: { id: '99999' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('E6: migración — bitácora histórica desde las columnas, una sola vez', () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    const conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    conn.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
    const ins = conn.prepare(`
      INSERT INTO orders (customer_name, quantity_hallacas, source, status, confirmed_at, expires_at, delivered_at, created_at, updated_at)
      VALUES (?, 5, ?, ?, ?, ?, ?, '2026-10-01 12:00:00', '2026-10-05 12:00:00')
    `);
    const entregada = ins.run('A', 'web', 'pagado', '2026-10-02 12:00:00', '2026-10-02 12:00:00', '2026-10-03 12:00:00').lastInsertRowid;
    const rechazada = ins.run('B', 'web', 'cancelado', null, '2026-10-02 12:00:00', null).lastInsertRowid;
    const panel = ins.run('C', 'admin', 'cancelado', '2026-10-01 12:00:00', null, null).lastInsertRowid;

    runMigrations(conn);
    runMigrations(conn);

    const ev = (id) => conn.prepare('SELECT event, actor, occurred_at FROM order_events WHERE order_id = ? ORDER BY id').all(id)
      .map((e) => `${e.event}/${e.actor}@${e.occurred_at}`);
    assert.deepEqual(ev(entregada), [
      'creado/sistema@2026-10-01 12:00:00', 'confirmado/admin@2026-10-02 12:00:00', 'entregado/admin@2026-10-03 12:00:00',
    ]);
    assert.deepEqual(ev(rechazada), ['creado/sistema@2026-10-01 12:00:00', 'rechazado/admin@2026-10-05 12:00:00']);
    assert.deepEqual(ev(panel), ['creado/admin@2026-10-01 12:00:00', 'cancelado/admin@2026-10-05 12:00:00']);
  } finally {
    console.log = realLog;
  }
});
