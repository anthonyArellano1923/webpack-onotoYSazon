/**
 * Esquema versionado (database/schema.js): una BD nueva y una BD existente de
 * cualquier versión anterior terminan en el mismo esquema, con user_version al
 * día, y re-correr no cambia nada.
 */
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateToLatest, getSteps, LATEST_VERSION } = require('../database/schema');

console.log = () => {};

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
const PLAN13 = fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-plan13.sql'), 'utf8');
const NEW_COLUMNS = ['confirmed_at', 'expires_at', 'reminder_sent_at', 'expired_notified_at'];

/** @returns {import('better-sqlite3').Database} fresh in-memory DB. */
function openDb() {
  const conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  return conn;
}

/**
 * Structural fingerprint independent of column order (ALTER ADD COLUMN appends).
 * @param {import('better-sqlite3').Database} conn
 * @returns {object}
 */
function fingerprint(conn) {
  const out = {};
  const objs = conn.prepare(
    "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
  ).all();
  out.objects = objs.map((o) => `${o.type}:${o.name}@${o.tbl_name}`);
  for (const t of objs.filter((o) => o.type === 'table')) {
    out[`cols:${t.name}`] = conn.prepare(`PRAGMA table_info('${t.name}')`).all()
      .map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`).sort();
    out[`fks:${t.name}`] = conn.prepare(`PRAGMA foreign_key_list('${t.name}')`).all()
      .map((f) => `${f.from}->${f.table}.${f.to}|${f.on_delete}`).sort();
  }
  for (const i of objs.filter((o) => o.type === 'index')) {
    out[`idx:${i.name}`] = conn.prepare(`PRAGMA index_info('${i.name}')`).all().map((c) => c.name);
  }
  out.checks = conn.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    .map((t) => `${t.name}:${[...(t.sql || '').matchAll(/CHECK\s*\((.*?)\)\s*[,)]/gs)].map((m) => m[1].replace(/\s+/g, ' ')).sort().join(';')}`);
  out.seeds = {
    settings: conn.prepare('SELECT * FROM settings').all(),
    packs: conn.prepare('SELECT id FROM packs ORDER BY id').all(),
  };
  return out;
}

const fresh = openDb();
migrateToLatest(fresh);
const FRESH = fingerprint(fresh);

test('BD nueva: queda en la última versión', () => {
  assert.equal(fresh.pragma('user_version', { simple: true }), LATEST_VERSION);
  assert.equal(getSteps().at(-1).version, LATEST_VERSION);
});

test('re-ejecutar no cambia el esquema ni la versión (idempotente)', () => {
  const conn = openDb();
  migrateToLatest(conn);
  migrateToLatest(conn);
  assert.deepEqual(fingerprint(conn), FRESH);
  assert.equal(conn.pragma('user_version', { simple: true }), LATEST_VERSION);
});

test('BD de PLAN-13 (user_version 0) converge al esquema de una BD nueva', () => {
  const conn = openDb();
  conn.exec(PLAN13);
  assert.equal(conn.pragma('user_version', { simple: true }), 0);
  migrateToLatest(conn);
  assert.deepEqual(fingerprint(conn), FRESH);
  assert.equal(conn.pragma('user_version', { simple: true }), LATEST_VERSION);
});

test('BD previa a PLAN-11 (sin columnas de revisión) converge al esquema nuevo', () => {
  const conn = openDb();
  const preSchema = SCHEMA.split('\n')
    .filter((l) => !NEW_COLUMNS.some((c) => new RegExp(`^\\s*${c}\\s`).test(l)))
    .join('\n');
  conn.exec(preSchema);
  migrateToLatest(conn);
  assert.deepEqual(fingerprint(conn), FRESH);
});

test('BD detenida en cada versión intermedia converge al mismo esquema', () => {
  // Simula un arranque interrumpido (o un deploy viejo) tras cada paso k.
  for (const stop of getSteps()) {
    const conn = openDb();
    for (const step of getSteps()) {
      if (step.version > stop.version) break;
      step.up(conn);
      conn.pragma(`user_version = ${step.version}`);
    }
    migrateToLatest(conn);
    assert.deepEqual(fingerprint(conn), FRESH, `desde v${stop.version} (${stop.name})`);
    assert.equal(conn.pragma('user_version', { simple: true }), LATEST_VERSION);
  }
});

test('BD con versión mayor a la conocida no se toca', () => {
  const conn = openDb();
  conn.pragma(`user_version = ${LATEST_VERSION + 5}`);
  const warn = console.warn;
  console.warn = () => {};
  try { migrateToLatest(conn); } finally { console.warn = warn; }
  assert.equal(conn.pragma('user_version', { simple: true }), LATEST_VERSION + 5);
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, 0);
});
