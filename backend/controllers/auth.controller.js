const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');

const SALT_ROUNDS = 12;

/**
 * Registro con el teléfono como identificador de cuenta (normalizado a
 * +56XXXXXXXXX antes de guardar, así "912345678" y "+56 9 1234 5678" son la
 * misma cuenta). Email y dirección son opcionales.
 */
async function register(req, res) {
  const { name, phone, password, email, address } = req.body;
  const normalizedPhone = normalizePhone(phone);

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone);
  if (existing) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese teléfono.' });
  }
  const normalizedEmail = email?.toLowerCase().trim() || null;
  if (normalizedEmail) {
    const emailTaken = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (emailTaken) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }
  }

  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.prepare(
      'INSERT INTO users (name, phone, email, password_hash, address) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), normalizedPhone, normalizedEmail, password_hash, address?.trim() || null);

    return res.status(201).json({
      message: 'Cuenta creada exitosamente',
      user: { id: result.lastInsertRowid, name: name.trim(), phone: normalizedPhone },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Error al crear la cuenta.' });
  }
}

async function login(req, res) {
  const { phone, password } = req.body;
  const normalizedPhone = normalizePhone(phone);

  const user = db.prepare(
    'SELECT id, name, phone, address, password_hash, role FROM users WHERE phone = ?'
  ).get(normalizedPhone);

  // Mismo mensaje para teléfono desconocido y contraseña incorrecta — no revela cuál falla
  if (!user) {
    return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
  }

  try {
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos.' });
    }

    const token = jwt.sign(
      { sub: user.id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
    );

    return res.json({
      accessToken: token,
      // phone/address viajan para prellenar el checkout (nombre, +56..., despacho)
      user: { id: user.id, name: user.name, phone: user.phone, address: user.address, role: user.role },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
}

module.exports = { register, login };
