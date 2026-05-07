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

module.exports = { authLimiter, apiLimiter };
