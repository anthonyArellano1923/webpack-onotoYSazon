const { db } = require('../database/db');
const { getStock, getStockBreakdown } = require('./packs.controller');
const { esFechaValida, esFechaFutura, FECHA_FUTURA_MSG } = require('../utils/fecha');
const { LIVE_ORDER_SQL } = require('../utils/orderState');
const { materializeExpirations } = require('../services/ledger');

/**
 * ADR-3 (plan 09): el stock es un dato propio que vive en `stock_movements`.
 * Este controlador es la única puerta de escritura de ajustes manuales.
 *
 *   stock = Σ stock_movements.delta (contados) − Σ ventas vivas.quantity_hallacas
 *
 * Las ventas se siguen restando derivadas de `orders` (packs.controller).
 * STOCK FASE 2: además dejan asientos 'venta'/'reverso' en el ledger, que
 * escribe services/ledger.js (no este controlador) y que el kardex muestra.
 * Y `production_batches` no se consulta en ninguna de estas funciones — borrar
 * o editar una tanda no puede mover el stock (invariante I-1).
 */

// Tope anti-envenenamiento, mismo criterio que R-5 en orders.controller: el
// backend protege de basura (dedos pegados en el teclado, requests manuales),
// no de negocios legítimos. 10.000 hallacas en un solo movimiento no existe.
const MAX_DELTA = 10000;

/**
 * Kardex: el ledger completo (stock_movements) por fecha descendente, con
 * saldo corrido. Sólo lectura, salvo poner al día los vencimientos.
 *
 * STOCK FASE 2: antes las ventas entraban DERIVADAS de `orders` con su fecha
 * de creación, así que un pedido reactivado aparecía en su fecha original y
 * un vencido simplemente desaparecía. Ahora cada línea es un asiento real con
 * la fecha en que ocurrió: la venta, su vencimiento (con la fecha del
 * vencimiento), la reactivación (con la de hoy), la cancelación, la merma.
 *
 * El saldo de la última línea coincide con getStock(): los asientos de un
 * pedido suman −(su reserva actual), así que
 *   Σ ledger = Σ movimientos contados − Σ reservas vivas = stock.
 * Para que eso valga también en el minuto en que una reserva vence sin que
 * nadie lo anote, primero se materializan los vencimientos pendientes.
 *
 * El saldo se acumula en orden ascendente (el saldo de una línea es el stock
 * que quedaba justo después de ella) y la lista se devuelve invertida, que es
 * como se lee un kardex: lo más reciente arriba.
 */
function getKardex(req, res) {
  try {
    materializeExpirations();

    const ascendente = db.prepare(`
      SELECT m.id, m.occurred_at, m.delta, m.reason, m.kind, m.batch_ref, m.order_id,
             o.status, o.delivered_at, o.deleted_at
      FROM stock_movements m
      LEFT JOIN orders o ON o.id = m.order_id
      ORDER BY m.occurred_at, m.created_at, m.id
    `).all().map((m) => ({
      // 'movimiento' = ajuste o tanda (con papelera); 'pedido' = asiento de
      // una venta, que se corrige desde la pestaña Ventas.
      tipo: m.order_id === null && ['ajuste', 'tanda'].includes(m.kind) ? 'movimiento' : 'pedido',
      id: m.id,
      order_id: m.order_id,
      fecha: m.occurred_at,
      delta: m.delta,
      motivo: m.reason,
      kind: m.kind,
      batch_ref: m.batch_ref,
      status: m.status ?? null,
      delivered_at: m.delivered_at ?? null,
      pedido_eliminado: m.deleted_at != null,
    }));

    let saldo = 0;
    for (const linea of ascendente) {
      saldo += linea.delta;
      linea.saldo = saldo;
    }

    // H-2: hallacas en encargos (sólo por encargo), fuera del stock — se
    // muestran en una línea aparte del panel.
    const { encargos } = db.prepare(`
      SELECT COALESCE(SUM(quantity_hallacas), 0) AS encargos
      FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 1
    `).get();

    return res.json({
      movimientos: ascendente.reverse(),
      ...getStockBreakdown(),
      encargos_por_coordinar: encargos,
    });
  } catch (err) {
    console.error('getKardex error:', err);
    return res.status(500).json({ error: 'Error al cargar el kardex.' });
  }
}

/**
 * Ingreso o egreso manual de stock. `delta` entero != 0 (positivo ingresa,
 * negativo egresa) y `reason` con al menos 3 caracteres — el motivo es
 * obligatorio a nivel de esquema, no sólo de UI: el negocio necesita el porqué
 * de cada movimiento, no sólo el número.
 */
function createMovement(req, res) {
  const { delta, reason, occurredAt } = req.body;

  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'La cantidad debe ser un entero distinto de 0.' });
  }
  if (Math.abs(delta) > MAX_DELTA) {
    return res.status(400).json({ error: `Cantidad fuera de rango (máximo ${MAX_DELTA} por movimiento).` });
  }
  // PLAN-13: String({}) = "[object Object]" pasaba el largo mínimo.
  const motivo = typeof reason === 'string' ? reason.trim() : '';
  if (motivo.length < 3) {
    return res.status(400).json({ error: 'El motivo es obligatorio (mínimo 3 caracteres).' });
  }
  // H-3: la fecha ordena el kardex y calcula el saldo corrido — una fecha
  // basura descoloca la tabla entera, así que se valida como el motivo.
  const fecha = String(occurredAt ?? '').trim() || null;
  if (fecha !== null && !esFechaValida(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida. Usa el formato AAAA-MM-DD.' });
  }
  if (fecha !== null && esFechaFutura(fecha)) {
    return res.status(400).json({ error: FECHA_FUTURA_MSG });
  }

  try {
    const result = db.prepare(`
      INSERT INTO stock_movements (occurred_at, delta, reason, kind, created_by)
      VALUES (COALESCE(?, date('now','localtime')), ?, ?, 'ajuste', ?)
    `).run(fecha, delta, motivo, req.user?.id ?? null);

    console.log(`[stock] movimiento #${result.lastInsertRowid}: ${delta > 0 ? '+' : ''}${delta} — ${motivo}`);
    return res.status(201).json({
      message: delta > 0 ? 'Ingreso registrado' : 'Egreso registrado',
      movement: { id: result.lastInsertRowid, delta, reason: motivo, kind: 'ajuste' },
      stock: getStock(),
    });
  } catch (err) {
    console.error('createMovement error:', err);
    return res.status(500).json({ error: 'Error al registrar el movimiento.' });
  }
}

/**
 * Borrado físico de un movimiento. Devuelve el `kind` para que la UI pueda
 * avisar distinto cuando se borra un ingreso originado por una tanda: ese
 * movimiento es independiente de la tanda (la tanda sigue en su tabla de
 * costos), borrarlo sólo baja el stock.
 */
function deleteMovement(req, res) {
  const { id } = req.params;
  const movement = db.prepare(
    'SELECT id, delta, kind, reason, order_id FROM stock_movements WHERE id = ?'
  ).get(id);
  if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  // STOCK FASE 2: los asientos de pedidos (venta, reverso, merma) son la
  // historia de una venta; se corrigen desde la venta, no borrando su asiento.
  if (movement.order_id !== null || !['ajuste', 'tanda'].includes(movement.kind)) {
    return res.status(409).json({ error: 'Este asiento pertenece a un pedido: corrígelo desde la pestaña Ventas.' });
  }

  try {
    db.prepare('DELETE FROM stock_movements WHERE id = ?').run(id);
    console.log(`[stock] movimiento #${movement.id} eliminado (${movement.kind}, delta ${movement.delta})`);
    return res.json({
      message: 'Movimiento eliminado',
      movement: { id: movement.id, delta: movement.delta, kind: movement.kind },
      stock: getStock(),
    });
  } catch (err) {
    console.error('deleteMovement error:', err);
    return res.status(500).json({ error: 'Error al eliminar el movimiento.' });
  }
}

module.exports = { getKardex, createMovement, deleteMovement };
