require('dotenv').config();

// PLAN-13: validar el entorno ANTES de cargar la BD y el resto de módulos;
// en producción un secreto débil aborta el arranque con un mensaje claro.
const { validateEnv } = require('./config/env');
try {
  validateEnv();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}

const { createApp } = require('./app');
const { createAdminIfNeeded } = require('./database/db');
const { holdHours, reminderHours, maxPorTelefono } = require('./utils/orderState');
const { startOrderSweeper } = require('./services/notify');

const app = createApp();
const PORT = process.env.PORT || 4000;

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
