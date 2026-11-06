/**
 * PLAN-12: Telegram bot (webhook security, whitelist, buttons, Notes drafts,
 * STOCK_INSUFICIENTE + force). Global fetch is mocked for Bot API calls; the
 * real fetch is kept for the local HTTP requests to the webhook.
 */
const h = require('./helpers');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const telegramRoutes = require('../routes/telegram.routes');
const bot = require('../services/telegramBot');

const realFetch = global.fetch;
const OWNER = 999;
const SECRET = 'secreto_de_prueba_1234567890';
let calls;
let server;
let baseUrl;
let updateId = 1;

console.warn = () => {};

/** Mocks Bot API calls; everything else goes to the real fetch. */
function mockTelegram() {
  global.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    }
    return realFetch(url, init);
  };
}

/** @returns {Array<object>} Bot API calls of one method. */
const sent = (method) => calls.filter((c) => c.method === method);

/**
 * Builds a text message update.
 * @param {string} text
 * @param {number} [chatId]
 */
const msg = (text, chatId = OWNER) => ({ update_id: updateId++, message: { message_id: 1, chat: { id: chatId }, text } });

/**
 * Builds a callback_query update (button press).
 * @param {string} data
 * @param {number} [chatId]
 * @param {string} [text] - Text of the message holding the button.
 */
const press = (data, chatId = OWNER, text = 'aviso') => ({
  update_id: updateId++,
  callback_query: { id: `cb${updateId}`, data, message: { message_id: 5, chat: { id: chatId }, text } },
});

/** Posts an update to the real webhook route. */
function postWebhook(update, secret = SECRET) {
  return realFetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify(update),
  });
}

/**
 * Creates a web order and discards its (async) new-order notice from `calls`,
 * so each test only sees the bot's own replies.
 * @param {object} opts - Same as helpers.webOrder.
 * @returns {Promise<number>} Order id.
 */
async function webOrder(opts) {
  const res = h.webOrder(opts);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  await new Promise((resolve) => setTimeout(resolve, 20));
  calls = [];
  return res.body.order.id;
}

/** Last button row data of a call's reply_markup. */
const buttons = (call) => (call.body.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data);

before(async () => {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/telegram', telegramRoutes);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  h.resetDb();
  bot._reset();
  calls = [];
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  process.env.TELEGRAM_CHAT_ID = String(OWNER);
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  delete process.env.TELEGRAM_ADMIN_CHAT_IDS;
  mockTelegram();
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

/* ---------------- Webhook y lista blanca ---------------- */

test('W1: webhook sin secreto o con secreto distinto → 401 y no procesa', async () => {
  h.addStock(10);
  for (const secret of [null, 'otro', `${SECRET}x`]) {
    const res = await postWebhook(msg('Elías: 4. Pagado.'), secret);
    assert.equal(res.status, 401);
  }
  assert.equal(calls.length, 0);
  assert.equal(bot._drafts.size, 0);
});

test('W2: sin TELEGRAM_BOT_TOKEN o sin TELEGRAM_WEBHOOK_SECRET el bot queda inactivo (401)', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal((await postWebhook(msg('/pedidos'))).status, 401);
  // Header vacío no coincide con un secreto vacío.
  assert.equal((await postWebhook(msg('/pedidos'), '')).status, 401);
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal((await postWebhook(msg('/pedidos'))).status, 401);
  assert.equal(calls.length, 0);
});

test('W3: chat ajeno con secreto válido → 200 y silencio total (sin fetch, sin escribir)', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 2 });
  calls = [];
  const r1 = await postWebhook(msg('/pedidos', 12345));
  const r2 = await postWebhook(press(`c:${id}`, 12345));
  const r3 = await postWebhook(msg('Elías: 4. Pagado.', 12345));
  for (const r of [r1, r2, r3]) assert.equal(r.status, 200);
  assert.equal(calls.length, 0);
  assert.equal(h.getOrder(id).confirmed_at, null);
  assert.equal(bot._drafts.size, 0);
});

test('W4: TELEGRAM_ADMIN_CHAT_IDS se suma a TELEGRAM_CHAT_ID', async () => {
  process.env.TELEGRAM_ADMIN_CHAT_IDS = '111, 222';
  assert.equal(bot.isAllowed(OWNER), true);
  assert.equal(bot.isAllowed(222), true);
  assert.equal(bot.isAllowed('111'), true);
  assert.equal(bot.isAllowed(333), false);
  assert.equal((await postWebhook(msg('/stock', 222))).status, 200);
  assert.equal(sent('sendMessage').length, 1);
});

test('W5: un update repetido (reintento de Telegram) se procesa una vez', async () => {
  const u = msg('/stock');
  await postWebhook(u);
  await postWebhook(u);
  assert.equal(sent('sendMessage').length, 1);
});

/* ---------------- Botones sobre pedidos ---------------- */

test('B1: botón sobre un pedido ya cancelado no hace nada', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 2 });
  h.patch(id, { status: 'cancelado' });
  const antes = h.getOrder(id);

  for (const action of ['c', 'p', 'e', 'x', 'c']) {
    await postWebhook(press(`${action}:${id}`));
  }
  // Y también con force: un botón viejo de "Registrar igual" tampoco reactiva.
  await postWebhook(press(`p:${id}:f`));

  assert.deepEqual(h.getOrder(id), antes);
  const edits = sent('editMessageText');
  assert.equal(edits.length, 6);
  for (const e of edits) assert.match(e.body.text, /cancelado/);
  assert.equal(sent('answerCallbackQuery').length, 6);
});

test('B2: Confirmar, Pagado y Entregado desde el aviso; el doble toque es inofensivo', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 3 });

  await postWebhook(press(`e:${id}`));
  assert.match(sent('editMessageText')[0].body.text, /Confirma el pedido antes/);
  assert.deepEqual(buttons(sent('editMessageText')[0]), [`c:${id}`]);
  assert.equal(h.getOrder(id).delivered_at, null);

  await postWebhook(press(`c:${id}`));
  assert.notEqual(h.getOrder(id).confirmed_at, null);
  await postWebhook(press(`c:${id}`));
  assert.match(sent('editMessageText')[2].body.text, /ya estaba confirmado/);

  await postWebhook(press(`p:${id}`));
  await postWebhook(press(`e:${id}`));
  const o = h.getOrder(id);
  assert.equal(o.status, 'pagado');
  assert.notEqual(o.delivered_at, null);
  assert.equal(sent('answerCallbackQuery').length, 5);
});

test('B3: Rechazar cancela un pedido por confirmar y libera el stock', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 4 });
  assert.equal(h.getStock(), 6);
  await postWebhook(press(`x:${id}`));
  assert.equal(h.getOrder(id).status, 'cancelado');
  assert.equal(h.getStock(), 10);
});

test('B4: STOCK_INSUFICIENTE al confirmar un vencido → pregunta y reenvía con force', async () => {
  h.addStock(5);
  const id = await webOrder({ hallacas: 4 });
  h.expire(id);
  h.manualSale({ quantityHallacas: 3 });
  assert.equal(h.getStock(), 2);

  await postWebhook(press(`c:${id}`));
  const ask = sent('editMessageText')[0];
  assert.match(ask.body.text, /esto deja el stock en -2\. ¿Registrar igual\?/);
  assert.deepEqual(buttons(ask), [`c:${id}:f`]);
  assert.equal(h.getOrder(id).confirmed_at, null);

  await postWebhook(press(`c:${id}:f`));
  assert.notEqual(h.getOrder(id).confirmed_at, null);
  assert.equal(h.getStock(), -2);
});

test('B5: comandos /confirmar, /pagado, /porpagar, /entregado con <id>', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 2 });
  await postWebhook(msg(`/confirmar ${id}`));
  await postWebhook(msg(`/pagado #${id}`));
  assert.equal(h.getOrder(id).status, 'pagado');
  await postWebhook(msg(`/porpagar ${id}`));
  assert.equal(h.getOrder(id).status, 'pendiente_pago');
  await postWebhook(msg(`/entregado ${id}`));
  assert.notEqual(h.getOrder(id).delivered_at, null);
  await postWebhook(msg('/pagado'));
  await postWebhook(msg('/pagado 9999'));
  const texts = sent('sendMessage').map((c) => c.body.text);
  assert.match(texts[4], /Uso: \/pagado <id>/);
  assert.match(texts[5], /#9999 no existe/);
});

/* ---------------- Formato de Notas ---------------- */

test('N1: el bloque de Notas → resumen con Confirmar/Cancelar; nada se escribe hasta confirmar', async () => {
  h.addStock(20);
  await postWebhook(msg(`Tanda prueba:
  Elías: 4. Por entregar. Pagado.
  Bryan Toloza: 2. Pendiente pago. Por entregar.
  Leonel Landaeta: 3. Pendiente de pago.
  Elvis Pacheco: 1. Pagada. Entregada.
  Fulano 3 pagado`));
  const summary = sent('sendMessage')[0];
  assert.match(summary.body.text, /Voy a registrar 4 cambios/);
  assert.match(summary.body.text, /línea 6: «Fulano 3 pagado»/);
  assert.match(summary.body.text, /«Tanda prueba:» \(encabezado\)/);
  const [ok, no] = buttons(summary);
  assert.match(ok, /^d:[0-9a-f]{12}:ok$/);
  assert.match(no, /^d:[0-9a-f]{12}:no$/);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);

  await postWebhook(press(ok, OWNER, summary.body.text));
  const rows = h.db.prepare('SELECT * FROM orders ORDER BY id').all();
  assert.deepEqual(rows.map((o) => [o.customer_name, o.quantity_hallacas, o.status, Boolean(o.delivered_at), o.source, o.customer_phone]), [
    ['Elías', 4, 'pagado', false, 'admin', null],
    ['Bryan Toloza', 2, 'pendiente_pago', false, 'admin', null],
    ['Leonel Landaeta', 3, 'pendiente_pago', false, 'admin', null],
    ['Elvis Pacheco', 1, 'pagado', true, 'admin', null],
  ]);
  for (const o of rows) assert.notEqual(o.confirmed_at, null);
  assert.equal(h.getStock(), 10);

  // Doble toque en Confirmar: el borrador ya se consumió, no duplica.
  await postWebhook(press(ok, OWNER, summary.body.text));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 4);
  assert.match(sent('editMessageText')[1].body.text, /expiró o ya se aplicó/);
});

test('N2: Cancelar descarta el borrador', async () => {
  h.addStock(20);
  await postWebhook(msg('Elías: 4. Pagado.'));
  const [, no] = buttons(sent('sendMessage')[0]);
  await postWebhook(press(no));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  assert.match(sent('editMessageText')[0].body.text, /Cancelado/);
});

test('N3: STOCK_INSUFICIENTE en una venta nueva → «Esto deja el stock en X» y force', async () => {
  h.addStock(3);
  await postWebhook(msg('Elías: 2. Pagado.\nAna: 5. Pendiente de pago. 912345678'));
  const [ok] = buttons(sent('sendMessage')[0]);
  await postWebhook(press(ok));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  const ask = sent('sendMessage')[1];
  assert.match(ask.body.text, /Esto deja el stock en -4\. ¿Registrar igual\?/);

  const [force] = buttons(ask);
  await postWebhook(press(force));
  const ana = h.db.prepare("SELECT * FROM orders WHERE customer_name = 'Ana'").get();
  assert.equal(ana.quantity_hallacas, 5);
  assert.equal(ana.customer_phone, '+56912345678');
  assert.equal(h.getStock(), -4);
});

test('N4: encargo no descuenta stock; nombre repetido avisa con #ID', async () => {
  h.addStock(5);
  h.manualSale({ customerName: 'Elías', quantityHallacas: 1 });
  await postWebhook(msg('Elías: 30. Encargo.'));
  const summary = sent('sendMessage')[0].body.text;
  assert.match(summary, /ojo: ya existe #\d+ con 1/);
  await postWebhook(press(buttons(sent('sendMessage')[0])[0]));
  const enc = h.db.prepare('SELECT * FROM orders WHERE quantity_hallacas = 30').get();
  assert.equal(enc.stock_exempt, 1);
  assert.equal(h.getStock(), 4);
});

test('N5: línea #ID cambia pago y entrega; nombre o cantidad distintos se señalan', async () => {
  h.addStock(20);
  const a = h.manualSale({ customerName: 'Elías', quantityHallacas: 4 }).body.order.id;
  const b = h.manualSale({ customerName: 'Elías', quantityHallacas: 2 }).body.order.id;
  await postWebhook(msg(`#${a} Elías: 4. Pagado. Entregado.\n#${b} Bryan: 2. Pagado.\n#${b}: 3. Pagado.`));
  const summary = sent('sendMessage')[0].body.text;
  assert.match(summary, /Voy a registrar 1 cambio/);
  assert.match(summary, /es de «Elías», no de «Bryan»/);
  assert.match(summary, /tiene 2 hallacas, no 3/);
  await postWebhook(press(buttons(sent('sendMessage')[0])[0]));
  assert.equal(h.getOrder(a).status, 'pagado');
  assert.notEqual(h.getOrder(a).delivered_at, null);
  assert.equal(h.getOrder(b).status, 'pendiente_pago');
});

test('N6: un #ID cancelado entre el resumen y el botón no se reactiva', async () => {
  h.addStock(20);
  const id = h.manualSale({ customerName: 'Elías', quantityHallacas: 4 }).body.order.id;
  await postWebhook(msg(`#${id}: Pagado.`));
  h.patch(id, { status: 'cancelado' });
  await postWebhook(press(buttons(sent('sendMessage')[0])[0]));
  assert.equal(h.getOrder(id).status, 'cancelado');
  assert.match(sent('editMessageText')[0].body.text, /se canceló mientras tanto/);
});

/* ---------------- Listados ---------------- */

test('L1: /pedidos lista activos con #ID y su salida se puede reenviar tal cual', async () => {
  h.addStock(20);
  const web = await webOrder({ hallacas: 2, name: 'Cliente Web' });
  const a = h.manualSale({ customerName: 'Elías', quantityHallacas: 4, status: 'pagado' }).body.order.id;
  const cerrado = h.manualSale({ customerName: 'Cerrado', quantityHallacas: 1, status: 'pagado' }).body.order.id;
  h.patch(cerrado, { delivered: true });

  await postWebhook(msg('/pedidos'));
  const text = sent('sendMessage')[0].body.text;
  assert.match(text, new RegExp(`Por confirmar:\\n#${web} Cliente Web: 2\\. Pendiente de pago\\. Por entregar\\.`));
  assert.match(text, new RegExp(`Confirmados:\\n#${a} Elías: 4\\. Pagado\\. Por entregar\\.`));
  assert.doesNotMatch(text, /Cerrado/);

  // Reenviar el listado sin cambios no propone nada ni marca errores.
  await postWebhook(msg(text));
  const back = sent('sendMessage')[1].body.text;
  assert.doesNotMatch(back, /No entendí/);
  assert.match(back, /sin cambios/);
});

test('L2: /pendientes y /stock', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 3 });
  const v = await webOrder({ hallacas: 1, phone: '933333333' });
  h.expire(v);
  await postWebhook(msg('/pendientes'));
  await postWebhook(msg('/stock'));
  const [pend, stock] = sent('sendMessage').map((c) => c.body.text);
  assert.match(pend, new RegExp(`Por confirmar:\\n#${id} `));
  assert.match(pend, new RegExp(`Vencidos.*\\n#${v} `));
  assert.match(stock, /Stock disponible: 7 hallacas/);
});

test('A1: el aviso de pedido web nuevo trae Confirmar, Rechazar, Pagado y Entregado', async () => {
  h.addStock(10);
  const res = h.webOrder({ hallacas: 2 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const id = res.body.order.id;
  const notice = sent('sendMessage')[0];
  assert.equal(notice.body.chat_id, String(OWNER));
  assert.equal(notice.body.parse_mode, undefined);
  assert.deepEqual(buttons(notice), [`c:${id}`, `x:${id}`, `p:${id}`, `e:${id}`]);
});
