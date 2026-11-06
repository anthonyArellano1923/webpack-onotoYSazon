/** PLAN-13: the FK indexes exist on a regular (non-legacy) database. */
const h = require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('índices FK presentes en una BD recién creada', () => {
  const names = (table) => h.db.prepare(`PRAGMA index_list('${table}')`).all().map((i) => i.name);
  const orders = names('orders');
  for (const i of ['idx_orders_user', 'idx_orders_batch', 'idx_orders_created']) assert.ok(orders.includes(i), i);
  assert.ok(names('stock_movements').includes('idx_stock_movements_created_by'));
  assert.ok(names('order_items').includes('idx_order_items_order'));
});
