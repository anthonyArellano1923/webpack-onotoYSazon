const jwt = require('jsonwebtoken');
const { db } = require('../database/db');

// PLAN-13: el rol sale de la BD en cada petición, no del JWT; así quitarle el
// rol a alguien surte efecto de inmediato. Consulta preparada una sola vez.
const findUser = db.prepare('SELECT id, role FROM users WHERE id = ?');

/**
 * Como requireAuth, pero nunca bloquea: si hay un Bearer token válido setea
 * req.user, si no lo hay (o es inválido/expiró) sigue sin autenticar. Usado
 * en rutas que aceptan pedidos anónimos pero quieren asociar el usuario
 * cuando hay sesión activa (ej. checkout del carrito).
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // QA-H2: el borrado de usuarios (QA-12) dejó tokens huérfanos vigentes — check de existencia por request.
    // A diferencia de requireAuth, acá NO se responde 401: si el usuario ya
    // no existe, el pedido simplemente degrada a anónimo (req.user queda sin
    // setear). Es a propósito — si dejáramos pasar un user_id fantasma,
    // createOrder violaría la FK orders.user_id → users.id y respondería 500
    // en vez de simplemente crear el pedido sin dueño.
    const row = findUser.get(payload.sub);
    if (row) {
      // Payload nuevo: { sub, phone, role } (login por teléfono)
      req.user = { id: payload.sub, phone: payload.phone, role: row.role };
    }
  } catch {
    // Token ausente/inválido/expirado: seguimos como pedido anónimo.
  }
  next();
}

module.exports = { optionalAuth };
