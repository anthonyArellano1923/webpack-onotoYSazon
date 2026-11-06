/**
 * STOCK FASE 2: bitácora de cambios de estado de cada pedido (`order_events`).
 *
 * Cada transición deja una fila con su fecha y quién la hizo:
 *   admin    → panel
 *   telegram → bot
 *   sistema  → checkout web, vencimiento de la reserva, migración
 *
 * Las funciones son síncronas y corren DENTRO de la transacción que escribe el
 * pedido, así que la bitácora nunca muestra un cambio que no se guardó.
 */
const { db } = require('../database/db');

const EVENTS = [
  'creado', 'confirmado', 'rechazado', 'expirado', 'reactivado',
  'pagado', 'entregado', 'cancelado', 'eliminado',
];
const ACTORS = ['admin', 'telegram', 'sistema'];

/**
 * Inserts one event.
 * @param {number} orderId
 * @param {string} event - One of EVENTS.
 * @param {string} actor - One of ACTORS.
 * @param {{detail?: string|null, at?: string|null}} [opts] - `at` is a UTC
 *   SQLite datetime; defaults to now.
 */
function recordEvent(orderId, event, actor, opts = {}) {
  if (!EVENTS.includes(event)) throw new Error(`Evento de pedido desconocido: ${event}`);
  if (!ACTORS.includes(actor)) throw new Error(`Actor de pedido desconocido: ${actor}`);
  db.prepare(`
    INSERT INTO order_events (order_id, event, actor, detail, occurred_at)
    VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(orderId, event, actor, opts.detail ?? null, opts.at ?? null);
}

/**
 * Records the events implied by an update, comparing the order before and
 * after it. Both rows need status, confirmed_at, delivered_at and live.
 *
 * - Cancelar un pedido sin confirmar es "rechazado"; uno confirmado, "cancelado".
 * - "reactivado": sale de cancelado, o vuelve a reservar tras haber vencido.
 *
 * @param {object} before
 * @param {object} after
 * @param {string} actor
 * @param {{cancelDetail?: string|null}} [opts]
 */
function recordTransitions(before, after, actor, opts = {}) {
  const id = after.id;
  const wasCancelled = before.status === 'cancelado';
  const isCancelled = after.status === 'cancelado';
  const backFromExpiry = !wasCancelled && !before.live && after.live;
  if ((wasCancelled && !isCancelled) || backFromExpiry) recordEvent(id, 'reactivado', actor);
  if (!before.confirmed_at && after.confirmed_at) recordEvent(id, 'confirmado', actor);
  if (before.status !== 'pagado' && after.status === 'pagado') recordEvent(id, 'pagado', actor);
  if (!before.delivered_at && after.delivered_at) recordEvent(id, 'entregado', actor);
  if (!wasCancelled && isCancelled) {
    recordEvent(id, before.confirmed_at ? 'cancelado' : 'rechazado', actor, { detail: opts.cancelDetail ?? null });
  }
}

/**
 * Lists the events of an order, oldest first.
 * @param {number} orderId
 * @returns {Array<{event: string, actor: string, detail: string|null, occurred_at: string}>}
 */
function listEvents(orderId) {
  return db.prepare(`
    SELECT event, actor, detail, occurred_at FROM order_events
    WHERE order_id = ? ORDER BY occurred_at, id
  `).all(orderId);
}

module.exports = { EVENTS, ACTORS, recordEvent, recordTransitions, listEvents };
