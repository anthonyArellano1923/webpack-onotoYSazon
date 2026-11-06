/**
 * PLAN-11: Telegram notifier (T13). Global fetch is mocked; the real one is
 * restored after each test.
 */
const h = require('./helpers');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../services/notify');

const realFetch = global.fetch;
let calls;

/**
 * Installs a fetch mock.
 * @param {'ok'|'throw'|'api-error'} mode
 */
function mockFetch(mode = 'ok') {
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (mode === 'throw') throw new Error('red caída');
    if (mode === 'api-error') return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
}

/** Enables Telegram config for the current test. */
function withToken() {
  process.env.TELEGRAM_BOT_TOKEN = '123:abc';
  process.env.TELEGRAM_CHAT_ID = '999';
}

/** Lets fire-and-forget promises (notify.newOrder) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Los fallos simulados de Telegram loguean warnings esperados.
console.warn = () => {};

beforeEach(() => {
  h.resetDb();
  h.addStock(100);
  calls = [];
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

afterEach(() => {
  global.fetch = realFetch;
});

test('T13a: sin token no llama a fetch y no lanza', async () => {
  mockFetch('ok');
  const r = await notify.newOrder({ id: 1, customer_name: 'X', quantity_hallacas: 1, delivery: 'retiro', customer_phone: '+56912345678' });
  assert.deepEqual(r, { sent: false, skipped: true });
  assert.equal(h.webOrder({ hallacas: 2 }).statusCode, 201);
  await settle();
  assert.equal(calls.length, 0);
});

test('T13b: con token, una llamada por pedido nuevo con enlace wa.me/569…', async () => {
  withToken();
  mockFetch('ok');
  const res = h.webOrder({ phone: '912345678', hallacas: 3, notes: '<b>hola</b>' });
  assert.equal(res.statusCode, 201);
  await settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.equal(calls[0].body.chat_id, '999');
  assert.equal(calls[0].body.disable_web_page_preview, true);
  assert.equal(calls[0].body.parse_mode, undefined);
  assert.match(calls[0].body.text, /wa\.me\/569\d{8}/);
  assert.match(calls[0].body.text, new RegExp(`#${res.body.order.id}`));
  assert.match(calls[0].body.text, /Panel: https:\/\/www\.onotosazon\.cl/);
});

test('T13c: fetch que lanza no impide el 201', async () => {
  withToken();
  mockFetch('throw');
  const res = h.webOrder({ hallacas: 2 });
  assert.equal(res.statusCode, 201);
  await settle();
  assert.equal(calls.length, 1);
});

test('T13d: barrido idempotente; si Telegram falla no marca y reintenta', async () => {
  withToken();
  mockFetch('ok');
  const id = h.webOrder({ hallacas: 2 }).body.order.id;
  await settle();
  calls = [];

  // Por vencer: dentro de la ventana de 4 h.
  h.db.prepare("UPDATE orders SET expires_at = datetime('now', '+2 hours') WHERE id = ?").run(id);
  assert.deepEqual(await notify.sweepOnce(), { reminders: 1, expired: 0 });
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /⏳/);
  assert.match(calls[0].body.text, /~2 h/);

  // Vencido.
  h.expire(id);
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 1 });
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 0 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.text, /⌛.*liberó 2 hallacas/);

  // Fallo de Telegram: no marca; el siguiente barrido reintenta.
  const otro = h.webOrder({ phone: '933333333', hallacas: 4 }).body.order.id;
  await settle();
  h.expire(otro);
  mockFetch('api-error');
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 0 });
  assert.equal(h.getOrder(otro).expired_notified_at, null);
  mockFetch('throw');
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 0 });
  assert.equal(h.getOrder(otro).expired_notified_at, null);
  mockFetch('ok');
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 1 });
  assert.notEqual(h.getOrder(otro).expired_notified_at, null);
});

test('T13d (sin token): el barrido marca igual para no acumular avisos viejos', async () => {
  mockFetch('ok');
  const id = h.webOrder({ hallacas: 2 }).body.order.id;
  h.expire(id);
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 1 });
  assert.equal(calls.length, 0);
  assert.notEqual(h.getOrder(id).expired_notified_at, null);
});

test('confirmados y cancelados no generan avisos del barrido', async () => {
  withToken();
  mockFetch('ok');
  const a = h.webOrder({ phone: '911111112', hallacas: 2 }).body.order.id;
  const b = h.webOrder({ phone: '911111113', hallacas: 2 }).body.order.id;
  await settle();
  calls = [];
  h.patch(a, { confirm: true });
  h.patch(b, { status: 'cancelado' });
  h.expire(a);
  h.expire(b);
  assert.deepEqual(await notify.sweepOnce(), { reminders: 0, expired: 0 });
  assert.equal(calls.length, 0);
});
