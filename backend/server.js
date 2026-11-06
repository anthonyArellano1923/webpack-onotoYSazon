require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { apiLimiter } = require('./middleware/rateLimiter');
const { createAdminIfNeeded } = require('./database/db');
const { holdHours, reminderHours, maxPorTelefono } = require('./utils/orderState');
const { startOrderSweeper } = require('./services/notify');

const authRoutes  = require('./routes/auth.routes');
const orderRoutes = require('./routes/orders.routes');
const adminRoutes = require('./routes/admin.routes');
const packsRoutes = require('./routes/packs.routes');
const telegramRoutes = require('./routes/telegram.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// Seguridad: headers HTTP seguros
app.use(helmet());

// CORS: solo permite el origen del frontend
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3006')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
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

// Error global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

createAdminIfNeeded();

// PLAN-11: leer las variables de pedidos al arrancar para que un valor
// inválido avise en el log de inicio y no recién con el primer pedido.
console.log(`  Pedidos: reserva ${holdHours()} h, aviso ${reminderHours()} h antes, máx. ${maxPorTelefono()} hallacas por teléfono`);

let sweeper = null;

const server = app.listen(PORT, () => {
  console.log(`✓ Backend corriendo en http://localhost:${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
  // PLAN-11: barrido de avisos por Telegram (por vencer / vencido). Solo
  // avisa: el vencimiento del stock se evalúa en cada consulta y no depende
  // de que este barrido corra.
  if (process.env.NODE_ENV !== 'test') sweeper = startOrderSweeper();
});

/**
 * Graceful shutdown: stops the sweeper and closes the HTTP server.
 * PLAN-11: al registrar un handler de SIGTERM, Node ya no termina solo; sin el
 * process.exit Render esperaría al SIGKILL en cada deploy.
 * @param {string} signal
 */
function shutdown(signal) {
  console.log(`→ ${signal} recibido, cerrando...`);
  if (sweeper) clearInterval(sweeper);
  server.close(() => process.exit(0));
  // Si alguna conexión keep-alive retiene el cierre, no colgar el deploy.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
