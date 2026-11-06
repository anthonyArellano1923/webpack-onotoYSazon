/**
 * PLAN-13: the role is read from the database on every request, so revoking
 * admin takes effect immediately even if the JWT still says "admin".
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('rol revocado en la BD pierde acceso admin con el mismo JWT', async () => {
  h.resetDb();
  const id = h.db.prepare(
    "INSERT INTO users (name, phone, password_hash, role) VALUES ('Dueño', '+56911112222', 'x', 'admin')"
  ).run().lastInsertRowid;
  // El token declara role admin; solo la BD decide.
  const token = jwt.sign({ sub: id, phone: '+56911112222', role: 'admin' }, process.env.JWT_SECRET);
  const get = () => fetch(`${baseUrl}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } });

  assert.equal((await get()).status, 200);

  h.db.prepare("UPDATE users SET role = 'customer' WHERE id = ?").run(id);
  assert.equal((await get()).status, 403);
});

test('un token con role admin de un usuario customer no da acceso', async () => {
  h.resetDb();
  const id = h.db.prepare(
    "INSERT INTO users (name, phone, password_hash, role) VALUES ('Cli', '+56933334444', 'x', 'customer')"
  ).run().lastInsertRowid;
  const token = jwt.sign({ sub: id, phone: '+56933334444', role: 'admin' }, process.env.JWT_SECRET);
  const res = await fetch(`${baseUrl}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 403);
});
