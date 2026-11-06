/**
 * PLAN-11: shared test setup. Must be required BEFORE any module that loads
 * database/db.js, because db.js opens the database at require time.
 *
 * Each test file runs in its own process (node --test), so each gets its own
 * in-memory database. Within a file, call resetDb() in beforeEach.
 */
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_PHONE = '911111111';
process.env.ADMIN_PASSWORD = 'Test-Admin-123';
process.env.ADMIN_NAME = 'Admin Test';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.ORDER_HOLD_HOURS;
delete process.env.ORDER_REMINDER_HOURS_BEFORE;
delete process.env.MAX_HALLACAS_POR_TELEFONO;
process.env.PUBLIC_ADMIN_URL = 'https://www.onotosazon.cl';

// Los avisos sin token hacen console.info en cada pedido: ruido en la salida.
console.info = () => {};

const { db } = require('../database/db');
const { createOrder } = require('../controllers/orders.controller');
const { updateOrder, createManualSale } = require('../controllers/admin.controller');
const { getStock } = require('../controllers/packs.controller');

/**
 * Fake Express response that captures status and JSON body.
 * @returns {{statusCode: number, body: any, status: Function, json: Function}}
 */
function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

/** Deletes all business rows (packs and settings are kept). */
function resetDb() {
  db.exec(`
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM stock_movements;
    DELETE FROM production_batches;
    DELETE FROM users;
  `);
}

/**
 * Inserts a manual stock movement.
 * @param {number} delta - Positive (income) or negative (outflow).
 */
function addStock(delta) {
  db.prepare("INSERT INTO stock_movements (delta, reason) VALUES (?, 'movimiento de prueba')").run(delta);
}

/**
 * Calls createOrder (web checkout) with sensible defaults.
 * `hallacas` builds a cart of `p1` packs (1 hallaca each).
 * @param {object} [opts]
 * @returns {ReturnType<typeof mockRes>}
 */
function webOrder({ phone = '912345678', hallacas = 10, items, user = null, quantityHallacas, notes, name = 'Cliente Test' } = {}) {
  const res = mockRes();
  createOrder({
    body: { name, phone, items: items || [{ packId: 'p1', qty: hallacas }], quantityHallacas, notes },
    user,
  }, res);
  return res;
}

/**
 * Calls updateOrder (admin PATCH).
 * @param {number} id
 * @param {object} body
 * @returns {ReturnType<typeof mockRes>}
 */
function patch(id, body) {
  const res = mockRes();
  updateOrder({ params: { id: String(id) }, body }, res);
  return res;
}

/**
 * Calls createManualSale (admin POST).
 * @param {object} body
 * @returns {ReturnType<typeof mockRes>}
 */
function manualSale(body) {
  const res = mockRes();
  createManualSale({ body: { customerName: 'Venta Panel', ...body }, user: { id: null } }, res);
  return res;
}

/**
 * Simulates the passage of time: the order's hold expired a minute ago.
 * @param {number} id
 */
function expire(id) {
  db.prepare("UPDATE orders SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(id);
}

/**
 * Reads an order row.
 * @param {number} id
 * @returns {object}
 */
function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Creates a customer user and returns the `req.user` shape.
 * @param {string} phone - E.164 phone.
 * @returns {{id: number, phone: string, role: string}}
 */
function createUser(phone = '+56987654321') {
  const id = db.prepare(
    "INSERT INTO users (name, phone, password_hash, role) VALUES ('Usuario', ?, 'x', 'customer')"
  ).run(phone).lastInsertRowid;
  return { id, phone, role: 'customer' };
}

module.exports = {
  db, mockRes, resetDb, addStock, webOrder, patch, manualSale, expire, getOrder, createUser, getStock,
};
