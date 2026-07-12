const jwt = require('jsonwebtoken');

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
    // Payload nuevo: { sub, phone, role } (login por teléfono)
    req.user = { id: payload.sub, phone: payload.phone, role: payload.role };
  } catch {
    // Token ausente/inválido/expirado: seguimos como pedido anónimo.
  }
  next();
}

module.exports = { optionalAuth };
