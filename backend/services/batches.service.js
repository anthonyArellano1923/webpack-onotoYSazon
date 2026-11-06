/**
 * Registro de tandas compartido por el panel (controllers/batches.controller.js)
 * y el bot de Telegram (services/telegramBot.js): una sola regla de validación
 * y una sola transacción, para que ningún canal tenga reglas propias.
 *
 * ADR-3: la tanda registra el costo Y empuja su cantidad al stock una vez, en
 * la misma transacción (si algo falla no queda ni tanda ni movimiento). El
 * movimiento nace independiente: `batch_ref` es una etiqueta histórica sin FK,
 * así que borrar o editar la tanda después NO lo toca (invariante I-1).
 */
const { db } = require('../database/db');
const { esFechaValida, esFechaFutura, FECHA_FUTURA_MSG } = require('../utils/fecha');
const { isMontoClp, MONTO_RANGE_MSG } = require('../utils/limits');

// Tope anti-envenenamiento, alineado con MAX_DELTA de stock.controller y con
// los topes R-5 del checkout: protege de dedos pegados en el teclado, no de
// negocios legítimos.
const MAX_CANTIDAD = 10000;

/**
 * Builds a client error (400) that callers turn into a response or a bot reply.
 * @param {string} message - Human-readable message in Spanish.
 * @returns {Error & {statusCode: number}}
 */
function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Validates and registers a production batch plus its stock income.
 * @param {object} input
 * @param {number} input.quantity - Hallacas produced (1..MAX_CANTIDAD).
 * @param {number|null} [input.costTotalClp] - Total cost in CLP.
 * @param {string|null} [input.producedAt] - YYYY-MM-DD, not in the future; defaults to today.
 * @param {string|null} [input.notes] - Free text.
 * @param {object} [ctx]
 * @param {number|null} [ctx.userId] - Admin user id, stored as `created_by`.
 * @returns {{batchId: number, movementId: number, fecha: string}}
 * @throws {Error & {statusCode: number}} 400 on invalid input.
 */
function createBatch({ quantity, costTotalClp, producedAt, notes } = {}, { userId = null } = {}) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest('La cantidad debe ser un entero mayor a 0.');
  }
  // H-6 (auditoría 10): sin este tope, la tanda era la puerta de atrás al stock.
  if (quantity > MAX_CANTIDAD) {
    throw badRequest(`Cantidad fuera de rango (máximo ${MAX_CANTIDAD} por tanda).`);
  }
  if (costTotalClp !== undefined && costTotalClp !== null && !isMontoClp(costTotalClp)) {
    throw badRequest(`El costo total debe ser un ${MONTO_RANGE_MSG}.`);
  }
  // PLAN-13: notes numérico/objeto reventaba en .trim() (500).
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    throw badRequest('Las notas deben ser texto.');
  }
  // H-3: la fecha viaja al movimiento de stock y ordena el kardex.
  const fechaPedida = String(producedAt ?? '').trim() || null;
  if (fechaPedida !== null && !esFechaValida(fechaPedida)) {
    throw badRequest('Fecha inválida. Usa el formato AAAA-MM-DD.');
  }
  // STOCK FASE 2: la tanda escribe un ingreso de stock con esta fecha.
  if (fechaPedida !== null && esFechaFutura(fechaPedida)) {
    throw badRequest(FECHA_FUTURA_MSG);
  }

  const insert = db.transaction(() => {
    const fecha = fechaPedida || db.prepare("SELECT date('now','localtime') AS d").get().d;
    const result = db.prepare(`
      INSERT INTO production_batches (produced_at, quantity, cost_total_clp, notes)
      VALUES (?, ?, ?, ?)
    `).run(fecha, quantity, Number.isInteger(costTotalClp) ? costTotalClp : 0, notes?.trim() || null);

    const batchId = Number(result.lastInsertRowid);
    const movement = db.prepare(`
      INSERT INTO stock_movements (occurred_at, delta, reason, kind, batch_ref, created_by)
      VALUES (?, ?, ?, 'tanda', ?, ?)
    `).run(fecha, quantity, `Ingreso por tanda del ${fecha}`, batchId, userId);

    return { batchId, movementId: Number(movement.lastInsertRowid), fecha };
  });

  const r = insert();
  console.log(`[tandas] tanda #${r.batchId} (${quantity} u.) → movimiento de stock #${r.movementId} (+${quantity})`);
  return r;
}

module.exports = { createBatch, MAX_CANTIDAD };
