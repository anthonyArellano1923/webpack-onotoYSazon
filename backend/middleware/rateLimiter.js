const rateLimit = require('express-rate-limit');

// Rutas de auth: máximo 5 intentos por 15 minutos
// skipSuccessfulRequests: solo cuenta los intentos fallidos
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: 'Demasiados intentos. Por favor espera 15 minutos antes de intentar nuevamente.',
  },
});

// API general: 100 peticiones por 15 minutos
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes. Por favor intenta más tarde.',
  },
});

// PLAN-11: pedidos web, 10 por hora por IP. Cada pedido reserva stock por
// horas; sin este tope un script podía vaciar el catálogo con teléfonos
// inventados. Requiere `trust proxy` en Render para ver la IP real.
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados pedidos desde esta conexión. Intenta de nuevo en una hora o escríbenos por WhatsApp.',
  },
});

module.exports = { authLimiter, apiLimiter, orderLimiter };
