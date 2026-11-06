/**
 * PLAN-12 (ADR-5): registra (o borra) el webhook del bot de Telegram.
 *
 *   node scripts/telegram-webhook.js            → setWebhook + comandos
 *   node scripts/telegram-webhook.js --delete   → deleteWebhook
 *   node scripts/telegram-webhook.js --info     → getWebhookInfo
 *
 * Lee TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y PUBLIC_API_URL (URL pública
 * del backend en Render, sin barra final) del entorno o de backend/.env.
 * Se corre a mano una vez por cambio de URL o de secreto, no en cada arranque:
 * así un deploy no pisa el webhook ni depende de que Telegram responda.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API = 'https://api.telegram.org';

/**
 * Calls a Bot API method and prints the result.
 * @param {string} token
 * @param {string} method
 * @param {object} [payload]
 * @returns {Promise<object>}
 */
async function call(token, method, payload = {}) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  console.log(`${method}:`, JSON.stringify(body));
  if (!body.ok) process.exitCode = 1;
  return body;
}

/** Entry point. */
async function main() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  const mode = process.argv[2];
  if (mode === '--delete') return call(token, 'deleteWebhook', { drop_pending_updates: false });
  if (mode === '--info') return call(token, 'getWebhookInfo');

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const base = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  // Telegram solo acepta A-Z a-z 0-9 _ - (1..256) en secret_token.
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET debe tener 16..256 caracteres A-Z a-z 0-9 _ -');
  }
  if (!/^https:\/\//.test(base)) throw new Error('PUBLIC_API_URL debe ser https://… (Telegram exige HTTPS).');

  await call(token, 'setWebhook', {
    url: `${base}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await call(token, 'setMyCommands', {
    commands: [
      { command: 'nuevo', description: 'Registrar un pedido paso a paso' },
      { command: 'tanda', description: 'Registrar una tanda nueva (suma al stock)' },
      { command: 'pedidos', description: 'Pedidos activos con su #ID' },
      { command: 'pendientes', description: 'Pedidos web por confirmar' },
      { command: 'stock', description: 'Stock disponible' },
      { command: 'confirmar', description: 'Confirmar pedido: /confirmar <id>' },
      { command: 'pagado', description: 'Marcar pagado: /pagado <id>' },
      { command: 'porpagar', description: 'Volver a pendiente de pago: /porpagar <id>' },
      { command: 'entregado', description: 'Marcar entregado: /entregado <id>' },
      { command: 'rechazar', description: 'Rechazar pedido web: /rechazar <id>' },
      { command: 'cancelar', description: 'Descartar el pedido en curso' },
      { command: 'ayuda', description: 'Comandos' },
    ],
  });
  return undefined;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
