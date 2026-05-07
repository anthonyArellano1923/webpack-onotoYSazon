const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database/db');

const SALT_ROUNDS = 12;

async function register(req, res) {
  const { name, email, password, phone } = req.body;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
  }

  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, phone) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), email.toLowerCase().trim(), password_hash, phone?.trim() || null);

    return res.status(201).json({
      message: 'Cuenta creada exitosamente',
      user: { id: result.lastInsertRowid, name: name.trim(), email: email.toLowerCase().trim() },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Error al crear la cuenta.' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;

  const user = db.prepare(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ?'
  ).get(email.toLowerCase());

  // Mismo mensaje para email incorrecto y contraseña incorrecta — no revela cuál falla
  if (!user) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  try {
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
    );

    return res.json({
      accessToken: token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
}

module.exports = { register, login };
