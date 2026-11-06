/**
 * PLAN-13: the auth limiter only counts wrong credentials (401). Own file:
 * the limiter is a singleton keyed by IP.
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

let server;
let baseUrl;
before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

/** POSTs JSON to an auth route and returns the status. */
async function post(route, body) {
  const res = await fetch(`${baseUrl}/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.status;
}

test('los 400 de validación no cuentan; solo las credenciales incorrectas (401)', async () => {
  h.resetDb();
  // 8 errores de validación: más que el máximo (5) y ninguno bloquea.
  for (let i = 0; i < 8; i += 1) assert.equal(await post('login', { phone: 'abc', password: 'x' }), 400);

  // Teléfono desconocido: 401 sin costo de bcrypt. Cuentan los 5 permitidos...
  for (let i = 0; i < 5; i += 1) assert.equal(await post('login', { phone: '955555555', password: 'x' }), 401);
  // ...y el sexto intento ya está bloqueado.
  assert.equal(await post('login', { phone: '955555555', password: 'x' }), 429);
});
