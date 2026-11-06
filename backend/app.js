/**
 * PLAN-13: Express app factory. Separated from server.js (which listens, seeds
 * the admin and starts the sweeper) so tests can exercise the real middleware
 * chain — CORS, body limit, rate limiters, error handler — without opening the
 * configured port.
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, corsError } = require('./middleware/errorHandler');

const authRoutes  = require('./routes/auth.routes');
const orderRoutes = require('./routes/orders.routes');
const adminRoutes = require('./routes/admin.routes');
const packsRoutes = require('./routes/packs.routes');
const telegramRoutes = require('./routes/telegram.routes');

/**
 * Builds the configured Express application. Reads CORS_ORIGIN and
 * TRUST_PROXY from the environment at call time.
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  // Seguridad: headers HTTP seguros
  app.use(helmet());

  // CORS: solo permite el origen del frontend
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3006')
    .split(',')
    .map(o => o.trim());

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // PLAN-13: error etiquetado; el handler central lo traduce a 403.
      callback(corsError(origin));
    },
    // QA-12: sin DELETE aquí el navegador bloquea el preflight CORS de los
    // nuevos endpoints de borrado (ventas, usuarios, lotes).
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200,
  }));

  // Limita tamaño del body para prevenir ataques de payload
  app.use(express.json({ limit: '10kb' }));

  // PLAN-11: detrás del proxy de Render, sin `trust proxy` todas las peticiones
  // llegan con la IP del proxy y los limiters (en especial orderLimiter) tratarían
  // a todos los clientes como uno solo. Debe ir ANTES de los limiters.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  // PLAN-12 (ADR-5): webhook del bot ANTES del limiter. Se autentica con el
  // secreto de setWebhook; un 429 haría que Telegram reintente el update.
  app.use('/api/telegram', telegramRoutes);

  // Rate limiting general a toda la API
  app.use('/api', apiLimiter);

  // Rutas
  app.use('/api/auth',   authRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/admin',  adminRoutes);
  app.use('/api/packs',  packsRoutes);

  // Health check — Render.com lo usa para saber si el servicio está vivo
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Error global (PLAN-13: 400/413/403 de cliente sin stack en el log)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
