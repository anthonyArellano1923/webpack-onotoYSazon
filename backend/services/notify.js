/**
 * PLAN-11 (ADR-4, D11/D13): avisos al dueño por bot de Telegram.
 *
 * Telegram es el ÚNICO canal de avisos (decisión cerrada del dueño). No se
 * agregan adaptadores para otros canales. Reglas:
 * - Sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no se envía nada (console.info).
 * - Un fallo de Telegram nunca hace fallar un pedido: todo error se loguea.
 * - Texto plano, sin parse_mode: el nombre o las notas del cliente no pueden
 *   inyectar formato ni enlaces disfrazados.
 * - Token y chat se leen en cada envío (no al cargar el módulo), para que
 *   configurarlos no exija reiniciar en tests ni en local.
 */
const { db } = require('../database/db');
const { reminderHours, parseUtc } = require('../utils/orderState');
const { phoneToWa } = require('../utils/phone');

const SEND_TIMEOUT_MS = 5000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Formats a UTC SQLite datetime in Chile's local time (DD/MM HH:MM).
 * @param {string|null} utc
 * @returns {string}
 */
function fmtChile(utc) {
  const d = parseUtc(utc);
  if (!d) return '—';
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * Common link lines: direct WhatsApp to the customer and the admin panel.
 * @param {object} order - orders row.
 * @returns {string}
 */
function links(order) {
  // phoneToWa quita el '+' del E.164: wa.me exige solo dígitos.
  const wa = phoneToWa(order.customer_phone);
  const lines = [wa ? `WhatsApp cliente: https://wa.me/${wa}` : 'WhatsApp cliente: (sin teléfono)'];
  const panel = (process.env.PUBLIC_ADMIN_URL || '').trim();
  if (panel) lines.push(`Panel: ${panel}`);
  return lines.join('\n');
}

/**
 * Sends a plain-text message through the Telegram Bot API.
 * Never throws.
 * @param {string} text
 * @returns {Promise<{sent: boolean, skipped: boolean}>} `skipped` is true when
 *   Telegram is not configured (nothing was attempted).
 */
async function send(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) {
    console.info('[notify] Telegram no configurado; aviso omitido.');
    return { sent: false, skipped: true };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    // La Bot API puede responder 200 con { ok: false }: solo es éxito si ambos.
    if (res.ok && body.ok) return { sent: true, skipped: false };
    console.warn(`[notify] Telegram respondió ${res.status}: ${body.description || 'sin detalle'}`);
  } catch (err) {
    console.warn(`[notify] Error enviando a Telegram: ${err.message}`);
  }
  return { sent: false, skipped: false };
}

/**
 * Notifies a new web order.
 * @param {object} order - Full orders row (after commit).
 * @returns {Promise<{sent: boolean, skipped: boolean}>}
 */
async function newOrder(order) {
  const encargo = order.stock_exempt === 1 ? ' (encargo)' : '';
  const text = [
    `🆕 Pedido web #${order.id}${encargo} — ${order.customer_name} — ${order.quantity_hallacas} hallacas (${order.delivery}) — vence ${fmtChile(order.expires_at)} (hora Chile)`,
    links(order),
  ].join('\n');
  return send(text);
}

/**
 * Notifies an order that is about to expire without confirmation.
 * @param {object} order - orders row.
 * @param {Date} [now]
 * @returns {Promise<{sent: boolean, skipped: boolean}>}
 */
async function orderExpiringSoon(order, now = new Date()) {
  const expires = parseUtc(order.expires_at);
  const hours = expires ? Math.max(1, Math.ceil((expires - now) / 3600000)) : reminderHours();
  const text = [
    `⏳ El pedido #${order.id} de ${order.customer_name} vence en ~${hours} h y aún no está confirmado.`,
    links(order),
  ].join('\n');
  return send(text);
}

/**
 * Notifies an order that expired without confirmation.
 * @param {object} order - orders row.
 * @returns {Promise<{sent: boolean, skipped: boolean}>}
 */
async function orderExpired(order) {
  const text = [
    `⌛ El pedido #${order.id} de ${order.customer_name} venció y liberó ${order.quantity_hallacas} hallacas.`,
    links(order),
  ].join('\n');
  return send(text);
}

let sweeping = false;

/**
 * One idempotent sweep: sends "expiring soon" and "expired" notices once per
 * order. A mark is written only when the send succeeded, or when Telegram is
 * not configured (so configuring it later does not flood old notices).
 * Business rules never depend on this sweep: expiry is evaluated per query.
 * @returns {Promise<{reminders: number, expired: number}>} Orders marked.
 */
async function sweepOnce() {
  // El barrido de arranque y el del intervalo no deben solaparse: duplicarían
  // avisos mientras esperan la respuesta de Telegram.
  if (sweeping) return { reminders: 0, expired: 0 };
  sweeping = true;
  const marked = { reminders: 0, expired: 0 };
  try {
    const porVencer = db.prepare(`
      SELECT * FROM orders
      WHERE confirmed_at IS NULL AND status != 'cancelado' AND reminder_sent_at IS NULL
        AND expires_at > datetime('now')
        AND expires_at <= datetime('now', '+' || ? || ' hours')
    `).all(reminderHours());
    const markReminder = db.prepare("UPDATE orders SET reminder_sent_at = datetime('now') WHERE id = ?");
    for (const order of porVencer) {
      const r = await orderExpiringSoon(order);
      if (r.sent || r.skipped) { markReminder.run(order.id); marked.reminders += 1; }
    }

    const vencidos = db.prepare(`
      SELECT * FROM orders
      WHERE confirmed_at IS NULL AND status != 'cancelado' AND expired_notified_at IS NULL
        AND expires_at <= datetime('now')
    `).all();
    const markExpired = db.prepare("UPDATE orders SET expired_notified_at = datetime('now') WHERE id = ?");
    for (const order of vencidos) {
      const r = await orderExpired(order);
      if (r.sent || r.skipped) { markExpired.run(order.id); marked.expired += 1; }
    }
  } finally {
    sweeping = false;
  }
  return marked;
}

/**
 * Starts the periodic sweep (once now, then every 10 minutes).
 * @returns {NodeJS.Timeout} Interval handle, to clearInterval on shutdown.
 */
function startOrderSweeper() {
  const run = () => sweepOnce().catch((err) => console.error('[notify] barrido falló:', err));
  run();
  return setInterval(run, SWEEP_INTERVAL_MS);
}

module.exports = { newOrder, orderExpiringSoon, orderExpired, sweepOnce, startOrderSweeper, send };
