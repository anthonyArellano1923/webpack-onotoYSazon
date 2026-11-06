/**
 * PLAN-11: admin panel — reactivation (T4), stock checks on PATCH (T8),
 * implicit confirmation (T9), delivery guard (T10), manual sales and encargos
 * (T11), invariant I-1 (T15) and kardex consistency (T16).
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { getKardex } = require('../controllers/stock.controller');
const { createBatch, updateBatch, deleteBatch } = require('../controllers/batches.controller');

beforeEach(() => h.resetDb());

/* ---------------------------- T4: reactivar vencido ---------------------------- */

test('T4a: confirmar un vencido con stock suficiente vuelve a reservar', () => {
  h.addStock(50);
  const id = h.webOrder({ hallacas: 10 }).body.order.id;
  h.expire(id);
  assert.equal(h.getStock(), 50);

  const res = h.patch(id, { confirm: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.order.review, 'confirmado');
  assert.equal(h.getStock(), 40);
});

test('T4b: confirmar un vencido sin stock → 409 STOCK_INSUFICIENTE con stock y requerido', () => {
  h.addStock(10);
  const id = h.webOrder({ hallacas: 10 }).body.order.id;
  h.expire(id);
  h.addStock(-5);

  const res = h.patch(id, { confirm: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'STOCK_INSUFICIENTE');
  assert.equal(res.body.stock, 5);
  assert.equal(res.body.requerido, 10);
  assert.equal(h.getOrder(id).confirmed_at, null);
});

test('T4c: el mismo caso con force → 200 y stock negativo', () => {
  h.addStock(10);
  const id = h.webOrder({ hallacas: 10 }).body.order.id;
  h.expire(id);
  h.addStock(-5);

  const res = h.patch(id, { confirm: true, force: true });
  assert.equal(res.statusCode, 200);
  assert.equal(h.getStock(), -5);
});

/* ---------------------------- T8: PATCH con stock ---------------------------- */

test('T8a: cancelado → pagado sin stock → 409; con force → 200', () => {
  h.addStock(10);
  const id = h.manualSale({ quantityHallacas: 10 }).body.order.id;
  assert.equal(h.patch(id, { status: 'cancelado' }).statusCode, 200);
  assert.equal(h.getStock(), 10);
  h.addStock(-5);

  const sinForce = h.patch(id, { status: 'pagado' });
  assert.equal(sinForce.statusCode, 409);
  assert.equal(sinForce.body.code, 'STOCK_INSUFICIENTE');
  assert.equal(sinForce.body.requerido, 10);
  assert.equal(h.getOrder(id).status, 'cancelado');

  assert.equal(h.patch(id, { status: 'pagado', force: true }).statusCode, 200);
  assert.equal(h.getStock(), -5);
});

test('T8b: subir cantidad sin stock → 409; bajar cantidad → 200 siempre', () => {
  h.addStock(12);
  const id = h.manualSale({ quantityHallacas: 10 }).body.order.id;

  const subir = h.patch(id, { quantityHallacas: 15 });
  assert.equal(subir.statusCode, 409);
  assert.equal(subir.body.stock, 2);
  assert.equal(subir.body.requerido, 5);

  h.addStock(-10); // stock -8: bajar igual debe pasar
  assert.equal(h.patch(id, { quantityHallacas: 5 }).statusCode, 200);
  assert.equal(h.getOrder(id).quantity_hallacas, 5);
});

test('T8c: quantityHallacas 0, "7" o null → 400', () => {
  h.addStock(20);
  const id = h.manualSale({ quantityHallacas: 10 }).body.order.id;
  for (const bad of [0, '7', null]) {
    assert.equal(h.patch(id, { quantityHallacas: bad }).statusCode, 400, `valor ${JSON.stringify(bad)}`);
  }
  assert.equal(h.getOrder(id).quantity_hallacas, 10);
});

test('notes y customerName con tipos inválidos → 400, no 500', () => {
  h.addStock(20);
  const id = h.manualSale({ quantityHallacas: 1 }).body.order.id;
  assert.equal(h.patch(id, { notes: 123 }).statusCode, 400);
  assert.equal(h.patch(id, { customerName: 5 }).statusCode, 400);
  assert.equal(h.patch(id, { notes: null }).statusCode, 200);
  assert.equal(h.patch('abc', { notes: 'x' }).statusCode, 400);
});

/* ---------------------------- T9 / T10 ---------------------------- */

test('T9: status pagado sobre un por_confirmar fija confirmed_at', () => {
  h.addStock(20);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  const res = h.patch(id, { status: 'pagado' });
  assert.equal(res.statusCode, 200);
  assert.notEqual(h.getOrder(id).confirmed_at, null);
  assert.equal(res.body.order.review, 'confirmado');
});

test('T10: delivered sobre un no confirmado → 409 PEDIDO_NO_CONFIRMADO', () => {
  h.addStock(20);
  const id = h.webOrder({ hallacas: 5 }).body.order.id;
  const res = h.patch(id, { delivered: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PEDIDO_NO_CONFIRMADO');
  assert.equal(h.getOrder(id).delivered_at, null);

  // Confirmar y entregar en el mismo PATCH sí es válido.
  assert.equal(h.patch(id, { confirm: true, delivered: true }).statusCode, 200);
  assert.notEqual(h.getOrder(id).delivered_at, null);
});

/* ---------------------------- T11: venta manual ---------------------------- */

test('T11a: venta manual nace confirmada, sin expires_at y sin tope de 20', () => {
  h.addStock(100);
  const res = h.manualSale({ customerPhone: '912345678', quantityHallacas: 30 });
  assert.equal(res.statusCode, 201);
  const row = h.getOrder(res.body.order.id);
  assert.notEqual(row.confirmed_at, null);
  assert.equal(row.expires_at, null);
  assert.equal(row.source, 'admin');
  assert.equal(h.getStock(), 70);
});

test('T11b: venta manual que deja stock negativo → 409; con force → 201', () => {
  h.addStock(5);
  const res = h.manualSale({ quantityHallacas: 10 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'STOCK_INSUFICIENTE');
  assert.equal(res.body.stock, 5);
  assert.equal(res.body.requerido, 10);

  assert.equal(h.manualSale({ quantityHallacas: 10, force: true }).statusCode, 201);
  assert.equal(h.getStock(), -5);
});

test('T11c: encargo no mueve el stock; confirmStock lo concreta con chequeo', () => {
  h.addStock(10);
  const res = h.manualSale({ quantityHallacas: 30, encargo: true });
  assert.equal(res.statusCode, 201);
  const id = res.body.order.id;
  assert.equal(h.getOrder(id).stock_exempt, 1);
  assert.equal(h.getStock(), 10);

  const sinStock = h.patch(id, { confirmStock: true, totalClp: 90000 });
  assert.equal(sinStock.statusCode, 409);
  assert.equal(sinStock.body.code, 'STOCK_INSUFICIENTE');
  assert.equal(sinStock.body.requerido, 30);
  assert.equal(h.getOrder(id).stock_exempt, 1);

  h.addStock(30);
  const ok = h.patch(id, { confirmStock: true, totalClp: 90000 });
  assert.equal(ok.statusCode, 200);
  assert.equal(h.getOrder(id).stock_exempt, 0);
  assert.equal(h.getStock(), 10);
});

test('T11e: confirmStock sobre un encargo web vencido lo confirma y reserva', () => {
  h.addStock(5);
  const id = h.webOrder({ items: [{ packId: 'pXL', qty: 1 }], quantityHallacas: 10 }).body.order.id;
  h.expire(id);

  const sinStock = h.patch(id, { confirmStock: true, totalClp: 30000 });
  assert.equal(sinStock.statusCode, 409);
  assert.equal(sinStock.body.code, 'STOCK_INSUFICIENTE');
  assert.equal(sinStock.body.requerido, 10);
  const intacto = h.getOrder(id);
  assert.equal(intacto.stock_exempt, 1);
  assert.equal(intacto.confirmed_at, null);

  h.addStock(10);
  const ok = h.patch(id, { confirmStock: true, totalClp: 30000 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.order.review, 'confirmado');
  assert.equal(h.getStock(), 5);

  h.expire(id);
  assert.equal(h.getStock(), 5);
});

test('T11d: venta manual con status cancelado → 400', () => {
  h.addStock(10);
  assert.equal(h.manualSale({ quantityHallacas: 1, status: 'cancelado' }).statusCode, 400);
});

/* ---------------------------- T15 / T16 ---------------------------- */

test('T15: invariante I-1 — borrar o editar una tanda no mueve el stock', () => {
  const created = h.mockRes();
  createBatch({ body: { quantity: 40, costTotalClp: 100000 }, user: { id: null } }, created);
  assert.equal(created.statusCode, 201);
  const batchId = h.db.prepare('SELECT id FROM production_batches').get().id;
  assert.equal(h.getStock(), 40);

  const edited = h.mockRes();
  updateBatch({ params: { id: String(batchId) }, body: { quantity: 10 } }, edited);
  assert.equal(edited.statusCode, 200);
  assert.equal(h.getStock(), 40);

  const deleted = h.mockRes();
  deleteBatch({ params: { id: String(batchId) } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(h.getStock(), 40);
});

test('T16: el saldo final del kardex coincide con getStock() en un escenario mixto', () => {
  h.addStock(100);
  h.addStock(-5);
  h.manualSale({ quantityHallacas: 10 });                       // confirmada
  h.webOrder({ phone: '911111112', hallacas: 5 });               // por confirmar
  const vencido = h.webOrder({ phone: '911111113', hallacas: 7 }).body.order.id;
  h.expire(vencido);                                             // vencido
  const cancelada = h.manualSale({ quantityHallacas: 3 }).body.order.id;
  h.patch(cancelada, { status: 'cancelado' });                   // cancelado
  h.manualSale({ quantityHallacas: 20, encargo: true });        // encargo

  const stock = h.getStock();
  assert.equal(stock, 100 - 5 - 10 - 5);

  const res = h.mockRes();
  getKardex({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.movimientos[0].saldo, stock);
  assert.equal(res.body.stock, stock);
  assert.equal(res.body.encargos_por_coordinar, 20);
  // STOCK FASE 2: el kardex es el ledger completo — cada pedido deja su venta
  // y, si dejó de reservar, su reverso (el vencido y el cancelado).
  const kinds = (k) => res.body.movimientos.filter((m) => m.kind === k).length;
  assert.equal(kinds('venta'), 4);
  assert.equal(kinds('reverso'), 2);
});
