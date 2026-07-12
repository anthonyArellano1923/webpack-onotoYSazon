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
  // El login ahora es por teléfono: el admin se identifica con ADMIN_PHONE
  // (env var en Render y .env). ADMIN_EMAIL queda como dato opcional de la
  // cuenta y como puente para migrar el admin sembrado por versiones viejas.
  const { normalizePhone } = require('../utils/phone');
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  if (!phone) {
    console.warn('⚠ ADMIN_PHONE no configurado o inválido: no se siembra cuenta admin.');
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) return;

  const email = process.env.ADMIN_EMAIL?.toLowerCase() || null;
  if (email) {
    // Admin creado por email en versiones anteriores: le asignamos el teléfono
    // para que pueda entrar con el login nuevo sin perder su cuenta.
    const legacy = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (legacy) {
      db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, legacy.id);
      console.log('✓ Cuenta admin existente actualizada con teléfono:', phone);
      return;
    }
  }

  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  db.prepare(
    'INSERT INTO users (name, phone, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run(process.env.ADMIN_NAME || 'Admin', phone, email, hash, 'admin');

  console.log('✓ Cuenta admin creada:', phone);
}

module.exports = { db, createAdminIfNeeded };
