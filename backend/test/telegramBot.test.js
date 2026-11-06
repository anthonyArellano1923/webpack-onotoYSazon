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
  // STOCK FASE 2: el rechazo queda en la bitácora firmado por el bot.
  const ev = h.db.prepare('SELECT event, actor FROM order_events WHERE order_id = ? ORDER BY id').all(id);
  assert.deepEqual(ev.map((e) => [e.event, e.actor]), [['creado', 'sistema'], ['rechazado', 'telegram']]);
});

test('B3b: Rechazar sobre un pedido entregado no lo cancela (A3 es decisión del panel)', async () => {
  h.addStock(10);
  const id = await webOrder({ hallacas: 4 });
  h.patch(id, { confirm: true, delivered: true });
  await postWebhook(press(`x:${id}`));
  assert.equal(h.getOrder(id).status, 'pendiente_pago');
  assert.equal(h.getStock(), 6);
  assert.match(sent('editMessageText').at(-1).body.text, /usa el panel/);
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

/* ---------------- Registro guiado /nuevo ---------------- */

/**
 * Data of the n:<token>:<choice> button with the given choice in the last message that has it.
 * @param {string} choice
 * @returns {string}
 */
function flowButton(choice) {
  const all = [...sent('sendMessage'), ...sent('editMessageText')].flatMap(buttons);
  const found = all.filter((d) => d.endsWith(`:${choice}`) && d.startsWith('n:'));
  assert.ok(found.length, `no hay botón ${choice}`);
  return found[found.length - 1];
}

/** @returns {string} Text of the last sendMessage. */
const lastText = () => sent('sendMessage').at(-1).body.text;

/** @returns {number} Number of orders in the DB. */
const countOrders = () => h.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

test('N1: /nuevo paso a paso → resumen → Confirmar registra una venta admin confirmada', async () => {
  h.addStock(20);
  await postWebhook(msg('/nuevo'));
  assert.match(lastText(), /Nombre del cliente/);
  await postWebhook(msg('Bryan Toloza'));
  assert.match(lastText(), /Cuántas hallacas/);
  await postWebhook(msg('2'));
  assert.match(lastText(), /Teléfono/);
  await postWebhook(msg('912345678'));
  assert.match(lastText(), /Pagado o pendiente/);
  await postWebhook(press(flowButton('pu')));
  assert.match(lastText(), /encargo/);
  await postWebhook(press(flowButton('e0')));
  assert.match(lastText(), /Resumen del pedido:\nCliente: Bryan Toloza\nHallacas: 2\nTeléfono: \+56912345678\nPago: Pendiente de pago\nEncargo: no/);
  assert.equal(countOrders(), 0);

  await postWebhook(press(flowButton('ok')));
  const o = h.db.prepare('SELECT * FROM orders').get();
  assert.equal(o.customer_name, 'Bryan Toloza');
  assert.equal(o.quantity_hallacas, 2);
  assert.equal(o.status, 'pendiente_pago');
  assert.equal(o.customer_phone, '+56912345678');
  assert.equal(o.source, 'admin');
  assert.notEqual(o.confirmed_at, null);
  assert.equal(o.stock_exempt, 0);
  assert.equal(h.getStock(), 18);
  // STOCK FASE 2: la venta del bot queda creada por telegram.
  assert.deepEqual(h.db.prepare('SELECT event, actor FROM order_events WHERE order_id = ?').all(o.id),
    [{ event: 'creado', actor: 'telegram' }]);
  // El resultado ofrece los botones que siguen teniendo sentido.
  assert.deepEqual(buttons(sent('editMessageText').at(-1)), [`p:${o.id}`, `e:${o.id}`]);

  // Doble toque en Confirmar: el flujo ya terminó, no duplica.
  await postWebhook(press(flowButton('ok')));
  assert.equal(countOrders(), 1);
});

test('N2: atajo /nuevo <nombre> <cantidad>, sin teléfono, pagado y encargo', async () => {
  h.addStock(5);
  await postWebhook(msg('/nuevo Elías Pérez 30'));
  assert.match(lastText(), /Teléfono/);
  await postWebhook(press(flowButton('nophone')));
  await postWebhook(press(flowButton('pp')));
  await postWebhook(press(flowButton('e1')));
  assert.match(lastText(), /Teléfono: \(sin teléfono\)[\s\S]*Encargo: sí/);
  await postWebhook(press(flowButton('ok')));
  const o = h.db.prepare('SELECT * FROM orders').get();
  assert.equal(o.customer_name, 'Elías Pérez');
  assert.equal(o.customer_phone, null);
  assert.equal(o.status, 'pagado');
  assert.equal(o.stock_exempt, 1);
  assert.equal(h.getStock(), 5);

  await postWebhook(msg('/nuevo Elías'));
  assert.match(lastText(), /Uso: \/nuevo/);
});

test('N3: entradas inválidas se vuelven a preguntar; el texto libre fuera de /nuevo no se interpreta', async () => {
  h.addStock(20);
  await postWebhook(msg('Elías: 4. Pagado.'));
  assert.match(lastText(), /usa \/nuevo/);
  assert.equal(bot._flows.size, 0);
  assert.equal(countOrders(), 0);

  await postWebhook(msg('/nuevo'));
  await postWebhook(msg('Elías'));
  for (const bad of ['cuatro', '0', '4.5', '20000', '-3']) {
    await postWebhook(msg(bad));
    assert.match(lastText(), /Cantidad inválida/, bad);
  }
  await postWebhook(msg('4'));
  await postWebhook(msg('12345'));
  assert.match(lastText(), /Teléfono inválido/);
  // En un paso de botones, escribir no avanza.
  await postWebhook(press(flowButton('nophone')));
  await postWebhook(msg('pagado'));
  assert.match(lastText(), /Elige con los botones/);
  assert.equal(countOrders(), 0);
});

test('N4: Cancelar, /cancelar y botones de un flujo viejo no registran nada', async () => {
  h.addStock(20);
  await postWebhook(msg('/nuevo Ana 3'));
  const viejo = flowButton('nophone');
  await postWebhook(press(flowButton('no')));
  assert.match(sent('editMessageText').at(-1).body.text, /no se registró nada/);

  await postWebhook(msg('/nuevo Ana 3'));
  await postWebhook(press(viejo));
  assert.match(sent('answerCallbackQuery').at(-1).body.text, /ya no está activo/);
  await postWebhook(msg('/cancelar'));
  assert.match(lastText(), /descartado/);
  await postWebhook(msg('Ana'));
  assert.match(lastText(), /usa \/nuevo/);
  assert.equal(countOrders(), 0);
});

test('N5: STOCK_INSUFICIENTE en /nuevo → «Esto deja el stock en X» y Registrar igual con force', async () => {
  h.addStock(3);
  await postWebhook(msg('/nuevo Ana 5'));
  await postWebhook(press(flowButton('nophone')));
  await postWebhook(press(flowButton('pu')));
  await postWebhook(press(flowButton('e0')));
  await postWebhook(press(flowButton('ok')));
  assert.equal(countOrders(), 0);
  const ask = sent('editMessageText').at(-1);
  assert.match(ask.body.text, /Esto deja el stock en -2\. ¿Registrar igual\?/);
  const [force] = buttons(ask);
  assert.match(force, /^d:[0-9a-f]{12}:ok$/);

  await postWebhook(press(force));
  assert.equal(countOrders(), 1);
  assert.equal(h.getStock(), -2);
  await postWebhook(press(force));
  assert.equal(countOrders(), 1);
});

test('N6: nombre repetido → el resumen avisa con los #ID', async () => {
  h.addStock(20);
  const id = h.manualSale({ customerName: 'Elías', quantityHallacas: 1 }).body.order.id;
  await postWebhook(msg('/nuevo elias 2'));
  await postWebhook(press(flowButton('nophone')));
  await postWebhook(press(flowButton('pu')));
  await postWebhook(press(flowButton('e0')));
  assert.match(lastText(), new RegExp(`Ojo: ya existe #${id} con 1`));
});

/* ---------------- Listados ---------------- */

test('L1: /pedidos lista activos con #ID y botones por pedido que redibujan la lista', async () => {
  h.addStock(20);
  const web = await webOrder({ hallacas: 2, name: 'Cliente Web' });
  const a = h.manualSale({ customerName: 'Elías', quantityHallacas: 4, status: 'pagado' }).body.order.id;
  const cerrado = h.manualSale({ customerName: 'Cerrado', quantityHallacas: 1, status: 'pagado' }).body.order.id;
  h.patch(cerrado, { delivered: true });

  await postWebhook(msg('/pedidos'));
  const list = sent('sendMessage')[0];
  assert.match(list.body.text, new RegExp(`Por confirmar:\\n#${web} Cliente Web — 2 hallacas — Pendiente de pago — por entregar`));
  assert.match(list.body.text, new RegExp(`Confirmados:\\n#${a} Elías — 4 hallacas — Pagado — por entregar`));
  assert.doesNotMatch(list.body.text, /Cerrado/);
  assert.deepEqual(list.body.reply_markup.inline_keyboard, [
    [
      { text: `✅ #${web}`, callback_data: `c:${web}:l` },
      { text: `✖️ #${web}`, callback_data: `x:${web}:l` },
      { text: `💰 #${web}`, callback_data: `p:${web}:l` },
      { text: `📦 #${web}`, callback_data: `e:${web}:l` },
    ],
    [{ text: `📦 #${a}`, callback_data: `e:${a}:l` }],
  ]);

  await postWebhook(press(`e:${a}:l`, OWNER, list.body.text));
  assert.notEqual(h.getOrder(a).delivered_at, null);
  const redraw = sent('editMessageText').at(-1);
  assert.match(redraw.body.text, new RegExp(`#${a} Elías: entregado`));
  // Pagado y entregado → cerrado: sale de la lista y de los botones.
  assert.doesNotMatch(redraw.body.text, /Confirmados:/);
  assert.equal(buttons(redraw).some((d) => d.includes(`:${a}:`)), false);
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

/* ---------------- Flujo guiado /tanda ---------------- */

/**
 * Latest /tanda button with the given choice.
 * @param {string} choice
 * @returns {string} callback_data
 */
function tandaButton(choice) {
  const all = [...sent('sendMessage'), ...sent('editMessageText')].flatMap(buttons);
  const found = all.filter((d) => d.startsWith('t:') && d.endsWith(`:${choice}`));
  assert.ok(found.length, `no hay botón ${choice}`);
  return found[found.length - 1];
}

/** @returns {Array<object>} Batches in the DB. */
const batches = () => h.db.prepare('SELECT * FROM production_batches ORDER BY id').all();

/** @returns {number} Sum of stock movements of kind 'tanda'. */
const tandaStock = () => h.db.prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE kind = 'tanda'").get().n;

test('T1: /tanda paso a paso → resumen → Registrar crea tanda e ingreso de stock', async () => {
  await postWebhook(msg('/tanda'));
  assert.match(lastText(), /\(1\/4\)/);
  await postWebhook(msg('120'));
  await postWebhook(msg('$250.000'));
  await postWebhook(msg('01-11-2026'));
  await postWebhook(msg('Tanda de prueba'));
  assert.match(lastText(), /Resumen de la tanda/);
  assert.match(lastText(), /Costo total: \$250\.000/);
  assert.equal(batches().length, 0, 'nada se registra antes de confirmar');

  await postWebhook(press(tandaButton('ok')));
  const [b] = batches();
  assert.equal(b.quantity, 120);
  assert.equal(b.cost_total_clp, 250000);
  assert.equal(b.produced_at, '2026-11-01');
  assert.equal(b.notes, 'Tanda de prueba');
  assert.equal(tandaStock(), 120);
  assert.match(sent('editMessageText').at(-1).body.text, /Tanda #\d+ registrada: 120 hallacas.*\nStock disponible: 120/);
  assert.equal(bot._flows.size, 0);
});

test('T2: atajo /tanda <cantidad> con Sin costo, Hoy y Sin notas; doble toque registra una sola vez', async () => {
  await postWebhook(msg('/tanda 50'));
  assert.match(lastText(), /\(2\/4\)/);
  await postWebhook(press(tandaButton('nocost')));
  await postWebhook(press(tandaButton('hoy')));
  await postWebhook(press(tandaButton('nonotes')));
  const ok = tandaButton('ok');
  await postWebhook(press(ok));
  await postWebhook(press(ok));
  assert.equal(batches().length, 1);
  assert.equal(batches()[0].cost_total_clp, 0);
  assert.equal(batches()[0].notes, null);
  assert.equal(tandaStock(), 50);
  assert.match(sent('answerCallbackQuery').at(-1).body.text, /ya no está activo/);
});

test('T3: entradas inválidas se vuelven a preguntar; fecha futura no registra', async () => {
  await postWebhook(msg('/tanda 0'));
  assert.match(lastText(), /Uso: \/tanda/);
  await postWebhook(msg('/tanda'));
  for (const bad of ['cien', '0', '10001', '4.5']) {
    await postWebhook(msg(bad));
    assert.match(lastText(), /Cantidad inválida/, bad);
  }
  await postWebhook(msg('30'));
  await postWebhook(msg('mucho'));
  assert.match(lastText(), /Costo inválido/);
  await postWebhook(msg('1000'));
  for (const bad of ['31-02-2026', 'ayer', '2026/11/01']) {
    await postWebhook(msg(bad));
    assert.match(lastText(), /Fecha inválida/, bad);
  }
  await postWebhook(msg('01-01-2099'));
  await postWebhook(press(tandaButton('nonotes')));
  await postWebhook(press(tandaButton('ok')));
  assert.match(sent('editMessageText').at(-1).body.text, /No se registró/);
  assert.equal(batches().length, 0);
  assert.equal(tandaStock(), 0);
});

test('T4: Cancelar y /cancelar descartan la tanda; botones de /nuevo no actúan sobre /tanda', async () => {
  await postWebhook(msg('/tanda 40'));
  await postWebhook(press(tandaButton('no')));
  assert.match(sent('editMessageText').at(-1).body.text, /Tanda cancelada/);

  await postWebhook(msg('/tanda 40'));
  const t = tandaButton('nocost').split(':')[1];
  await postWebhook(press(`n:${t}:nophone`));
  assert.match(sent('answerCallbackQuery').at(-1).body.text, /ya no está activo/);
  // Ni siquiera en el paso final un botón n: registra un pedido con datos de la tanda.
  await postWebhook(press(tandaButton('nocost')));
  await postWebhook(press(tandaButton('hoy')));
  await postWebhook(press(tandaButton('nonotes')));
  await postWebhook(press(`n:${t}:ok`));
  assert.equal(countOrders(), 0);
  await postWebhook(msg('/cancelar'));
  assert.match(lastText(), /Tanda en curso descartada/);
  assert.equal(batches().length, 0);
});
