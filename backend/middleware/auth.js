const jwt = require('jsonwebtoken');
const { db } = require('../database/db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado. Por favor inicia sesión.' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // QA-H2: el borrado de usuarios (QA-12) dejó tokens huérfanos vigentes — check de existencia por request.
    // El JWT es válido hasta expirar (2h) aunque el usuario ya no exista en
    // la BD; sin este check un usuario borrado seguiría "autenticado".
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.sub);
    if (!exists) {
      return res.status(401).json({ error: 'Sesión inválida. Por favor inicia sesión nuevamente.' });
    }
    // Payload nuevo: { sub, phone, role } (login por teléfono)
    req.user = { id: payload.sub, phone: payload.phone, role: payload.role };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Por favor inicia sesión nuevamente.' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

module.exports = { requireAuth };
