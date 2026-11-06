/**
 * PLAN-13: client errors go through the REAL app (createApp) and must answer
 * 400/413/403 with a Spanish `{ error }` and without logging a stack trace.
 */
process.env.CORS_ORIGIN = 'http://localhost:3006';
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

let server;
let baseUrl;
let errorCalls;
const realConsoleError = console.error;

before(async () => {
  console.error = (...args) => { errorCalls.push(args); };
  errorCalls = [];
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => { console.error = realConsoleError; server.close(resolve); }));

/** Posts a raw body to the orders endpoint. */
function post(body, headers = {}) {
  return fetch(`${baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
  });
}

test('JSON malformado → 400 en español, sin log de error', async () => {
  errorCalls.length = 0;
  const res = await post('{"name": ');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /JSON/);
  assert.equal(errorCalls.length, 0);
});

test('body demasiado grande → 413, sin log de error', async () => {
  errorCalls.length = 0;
  const res = await post(JSON.stringify({ notes: 'x'.repeat(20000) }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /grande/);
  assert.equal(errorCalls.length, 0);
});

test('origen no permitido por CORS → 403; el permitido pasa', async () => {
  errorCalls.length = 0;
  const bad = await fetch(`${baseUrl}/api/packs`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.match((await bad.json()).error, /Origen/);
  assert.equal(errorCalls.length, 0);

  // Control positivo: el origen configurado responde 200 con su cabecera CORS.
  const ok = await fetch(`${baseUrl}/api/packs`, { headers: { Origin: 'http://localhost:3006' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3006');
});

test('un error inesperado sigue siendo 500 y sí se registra', async () => {
  const { errorHandler } = require('../middleware/errorHandler');
  errorCalls.length = 0;
  const res = h.mockRes();
  errorHandler(new Error('boom'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Error interno del servidor.');
  assert.equal(errorCalls.length, 1);
});
