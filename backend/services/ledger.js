/**
 * STOCK FASE 2: asientos de pedidos en `stock_movements` (ledger completo).
 *
 * Cada pedido deja en el ledger su historia de reservas: 'venta' (negativo)
 * cuando empieza a reservar o reserva más, 'reverso' (positivo) cuando libera
 * o reserva menos. La suma de los asientos de un pedido es SIEMPRE −(su reserva
 * actual), y la reserva actual sale de LIVE_ORDER_SQL, igual que el stock.
 *
 * Por qué se concilia contra un objetivo y no se escribe "la diferencia que
 * calculó el llamador": un pedido web vencido deja de reservar sin que nadie
 * escriba nada (ADR-4). Si al confirmarlo tarde se anotara "antes 0, después
 * qty", la venta original nunca tendría su reverso y el pedido quedaría
 * descontado dos veces en el ledger. `syncOrderLedger` mira lo que el ledger
 * ya tiene y escribe solo lo que falta, así que llamarlo de más es inofensivo.
 *
 * Estos asientos NO entran al número de stock (COUNTED_MOVEMENT_SQL): son la
 * historia fechada. El stock sigue saliendo de los pedidos vivos (ADR-3).
 *
 * Contrato: funciones síncronas, pensadas para correr DENTRO de la transacción
 * del llamador, que es la que escribe el pedido.
 */
const { db } = require('../database/db');
const { LIVE_ORDER_SQL, EXPIRED_REVIEW_SQL, ORDER_LEDGER_SQL } = require('../utils/orderState');

/**
 * Net of the shadow rows of an order (= −reservation recorded in the ledger).
 * @param {number} orderId
 * @returns {number}
 */
function orderLedgerNet(orderId) {
  return db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS net FROM stock_movements
    WHERE order_id = ? AND ${ORDER_LEDGER_SQL}
  `).get(orderId).net;
}

/**
 * Reads the fields that decide an order's reservation.
 * @param {number} orderId
 * @returns {object|undefined}
 */
function readOrder(orderId) {
  return db.prepare(`
    SELECT id, status, quantity_hallacas, stock_exempt, customer_name, expires_at,
           (${LIVE_ORDER_SQL}) AS live,
           (${EXPIRED_REVIEW_SQL}) AS expired
    FROM orders WHERE id = ?
  `).get(orderId);
}

/**
 * Default reason for a ledger row, from what the order looks like now.
 * @param {object} o - readOrder row.
 * @param {number} reserved - Reservation recorded in the ledger before this row.
 * @param {number} target - Reservation the order should have.
 * @param {boolean} hadRows - Whether the order already had ledger rows.
 * @returns {string}
 */
function defaultReason(o, reserved, target, hadRows) {
  const ref = `pedido #${o.id}`;
  if (target > reserved) {
    if (reserved > 0) return `Aumento de cantidad del ${ref}`;
    if (hadRows) return `Reactivación del ${ref}`;
    const name = o.customer_name || 'cliente';
    return `Pedido #${o.id} de ${name}${o.status === 'cortesia' ? ' (cortesía)' : ''}`;
  }
  if (target > 0) return `Rebaja de cantidad del ${ref}`;
  if (o.status === 'cancelado') return `Cancelación del ${ref}`;
  return `Liberación del ${ref}`;
}

/**
 * Brings the ledger of one order in line with its current reservation.
 *
 * When the order is a web hold that expired, the release is dated on the
 * expiry instant (not on the day someone noticed), so the kardex shows when
 * the stock really came back.
 *
 * @param {number} orderId
 * @param {{fecha?: string|null, reason?: string, createdBy?: number|null, target?: number}} [ctx]
 *   `fecha` (YYYY-MM-DD) dates a new reservation; `target` overrides the
 *   computed reservation (used when the order is about to disappear).
 * @returns {{delta: number, kind: string, expired: boolean}|null} Row written, or null.
 */
function syncOrderLedger(orderId, ctx = {}) {
  const o = readOrder(orderId);
  if (!o) return null;
  const net = orderLedgerNet(orderId);
  const reserved = -net;
  const target = ctx.target ?? ((o.live && o.stock_exempt === 0) ? o.quantity_hallacas : 0);
  if (target === reserved) return null;

  const delta = reserved - target;
  const kind = delta < 0 ? 'venta' : 'reverso';
  const expired = delta > 0 && o.expired === 1 && ctx.target === undefined;
  const hadRows = db.prepare('SELECT 1 FROM stock_movements WHERE order_id = ? LIMIT 1').get(orderId) !== undefined;
  const reason = expired
    ? `Vencimiento del pedido #${o.id} sin confirmar`
    : (ctx.reason || defaultReason(o, reserved, target, hadRows));

  // Vencido: fecha y hora del vencimiento real (expires_at, UTC). Si no, la
  // fecha pedida o la de hoy, y created_at = ahora.
  db.prepare(`
    INSERT INTO stock_movements (occurred_at, delta, reason, kind, order_id, created_by, created_at)
    VALUES (
      COALESCE(?, date(?, 'localtime'), date('now','localtime')),
      ?, ?, ?, ?, ?,
      COALESCE(?, datetime('now'))
    )
  `).run(
    expired ? null : (ctx.fecha ?? null),
    expired ? o.expires_at : null,
    delta, reason, kind, orderId, ctx.createdBy ?? null,
    expired ? o.expires_at : null,
  );
  return { delta, kind, expired };
}

/**
 * Writes the pending releases of every web hold that expired unnoticed.
 * Idempotent: an order already reconciled gets nothing.
 * @returns {number} Orders that received a release row.
 */
function materializeExpirations() {
  const run = db.transaction(() => {
    const ids = db.prepare(`SELECT id FROM orders WHERE ${EXPIRED_REVIEW_SQL}`).all();
    let n = 0;
    for (const { id } of ids) if (syncOrderLedger(id)) n += 1;
    return n;
  });
  return run.immediate();
}

module.exports = { syncOrderLedger, materializeExpirations, orderLedgerNet };
