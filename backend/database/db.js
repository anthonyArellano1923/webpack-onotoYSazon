const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'onoto.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

// Estas pragmas deben aplicarse en cada conexión
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// CREATE TABLE IF NOT EXISTS — seguro ejecutar múltiples veces
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Trae al día bases de datos creadas con el schema viejo (idempotente)
const { runMigrations } = require('./migrate');
runMigrations(db);

function createAdminIfNeeded() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;

  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(process.env.ADMIN_NAME || 'Admin', email, hash, 'admin');

  console.log('✓ Cuenta admin creada:', email);
}

module.exports = { db, createAdminIfNeeded };
