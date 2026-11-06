/**
 * PLAN-13: startup environment validation (config/env.js) and the real boot of
 * server.js in production with a bad configuration.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateEnv, collectEnvProblems, EXAMPLE_ADMIN_PASSWORD } = require('../config/env');

const GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ADMIN_PASSWORD: 'UnaClaveDistinta-9876',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_WEBHOOK_SECRET: '',
};

test('el ADMIN_PASSWORD de ejemplo coincide con .env.example', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(example, new RegExp(`^ADMIN_PASSWORD=${EXAMPLE_ADMIN_PASSWORD.replace(/[!]/g, '\\$&')}$`, 'm'));
});

test('producción: entorno correcto no lanza', () => {
  assert.deepEqual(validateEnv(GOOD), []);
  // Token con secreto también es válido.
  assert.deepEqual(validateEnv({ ...GOOD, TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_WEBHOOK_SECRET: 's'.repeat(20) }), []);
});

test('producción: JWT_SECRET ausente o corto aborta', () => {
  assert.throws(() => validateEnv({ ...GOOD, JWT_SECRET: undefined }), /JWT_SECRET/);
  assert.throws(() => validateEnv({ ...GOOD, JWT_SECRET: 'a'.repeat(31) }), /JWT_SECRET/);
  assert.doesNotThrow(() => validateEnv({ ...GOOD, JWT_SECRET: 'a'.repeat(32) }));
});

test('producción: ADMIN_PASSWORD de ejemplo aborta', () => {
  assert.throws(() => validateEnv({ ...GOOD, ADMIN_PASSWORD: EXAMPLE_ADMIN_PASSWORD }), /ADMIN_PASSWORD/);
});

test('producción: token de Telegram sin secreto de webhook aborta', () => {
  assert.throws(() => validateEnv({ ...GOOD, TELEGRAM_BOT_TOKEN: '1:abc' }), /TELEGRAM_WEBHOOK_SECRET/);
});

test('desarrollo: solo avisa con warn, no lanza', () => {
  const warnings = [];
  const env = { NODE_ENV: 'development', JWT_SECRET: 'corto', ADMIN_PASSWORD: EXAMPLE_ADMIN_PASSWORD };
  const problems = validateEnv(env, { warn: (m) => warnings.push(m) });
  assert.equal(problems.length, 2);
  assert.equal(warnings.length, 2);
  assert.equal(collectEnvProblems(GOOD).length, 0);
});

test('server.js en producción con JWT_SECRET corto termina con código 1 y mensaje claro', () => {
  const r = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    // Entorno explícito (sin heredar nada): dotenv no pisa variables ya definidas.
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: 'corto',
      ADMIN_PASSWORD: 'UnaClaveDistinta-9876', TELEGRAM_BOT_TOKEN: '', TELEGRAM_WEBHOOK_SECRET: '',
      DB_PATH: ':memory:', PORT: '0',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /JWT_SECRET/);
});
