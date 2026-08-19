const { db } = require('../database/db');
const { esFechaValida } = require('../utils/fecha');

// Tope anti-envenenamiento, alineado con MAX_DELTA de stock.controller y con
// los topes R-5 del checkout: protege de dedos pegados en el teclado, no de
// negocios legítimos.
const MAX_CANTIDAD = 10000;

/**
 * ADR-3 (plan 09): las tandas son el registro de COSTOS del negocio (inversión,
 * costo por hallaca, ganancia, margen). NO calculan el stock: ninguna función de
 * este archivo se consulta para saber la disponibilidad (invariante I-1).
 *
 * Registrar una tanda SÍ ingresa su cantidad al stock, pero como un movimiento
 * INDEPENDIENTE en stock_movements (createBatch). Ese movimiento no queda atado
 * a la tanda: editarla o borrarla después no lo revierte ni lo modifica.
 */

/**
 * QA-16/ADR-2: tanda vigente a la que se atribuyen las ventas nuevas. Se usa
 * la más reciente por `produced_at` (desempate por id) — no hay concepto de
 * tanda "activa" explícito, el negocio siempre vende de lo último producido.
 * NULL si aún no hay tandas registradas (ventas quedan sin atribuir).
 */
function getCurrentBatchId() {
  const row = db.prepare(`
    SELECT id FROM production_batches ORDER BY produced_at DESC, id DESC LIMIT 1
  `).get();
  return row ? row.id : null;
}

function getAllBatches(req, res) {
  const batches = db.prepare(`
    SELECT id, produced_at, quantity, cost_total_clp, notes, created_at
    FROM production_batches ORDER BY produced_at DESC, id DESC
  `).all();

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(quantity), 0) AS quantity,
      COALESCE(SUM(cost_total_clp), 0) AS cost_total_clp
    FROM production_batches
  `).get();

  return res.json({
    batches,
    totals: {
      quantity: totals.quantity,
      cost_total_clp: totals.cost_total_clp,
      costo_promedio: totals.quantity > 0 ? Math.round(totals.cost_total_clp / totals.quantity) : 0,
    },
  });
}

function createBatch(req, res) {
  const { producedAt, quantity, costTotalClp, notes } = req.body;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'La cantidad debe ser un entero mayor a 0.' });
  }
  // H-6 (auditoría 10): sin este tope, la tanda era la puerta de atrás al stock
  // — `MAX_MOVIMIENTO` protegía los movimientos manuales pero una tanda de
  // 999.999.999 entraba igual y creaba ese ingreso. Mismo criterio que R-5.
  if (quantity > MAX_CANTIDAD) {
    return res.status(400).json({ error: `Cantidad fuera de rango (máximo ${MAX_CANTIDAD} por tanda).` });
  }
  if (costTotalClp !== undefined && costTotalClp !== null && (!Number.isInteger(costTotalClp) || costTotalClp < 0)) {
    return res.status(400).json({ error: 'El costo total debe ser un entero ≥ 0.' });
  }
  // H-3: la fecha viaja al movimiento de stock y ordena el kardex.
  const fechaPedida = String(producedAt ?? '').trim() || null;
  if (fechaPedida !== null && !esFechaValida(fechaPedida)) {
    return res.status(400).json({ error: 'Fecha inválida. Usa el formato AAAA-MM-DD.' });
  }

  // ADR-3: la tanda registra el costo Y empuja su cantidad al stock una vez, en
  // la misma transacción (si algo falla no queda ni tanda ni movimiento). El
  // movimiento nace independiente: `batch_ref` es una etiqueta histórica sin FK,
  // así que borrar o editar la tanda después NO lo toca (invariante I-1).
  const insertBatch = db.transaction(() => {
    const fecha = fechaPedida
      || db.prepare("SELECT date('now','localtime') AS d").get().d;

    const result = db.prepare(`
      INSERT INTO production_batches (produced_at, quantity, cost_total_clp, notes)
      VALUES (?, ?, ?, ?)
    `).run(
      fecha,
      quantity,
      Number.isInteger(costTotalClp) ? costTotalClp : 0,
      notes?.trim() || null
    );

    const batchId = result.lastInsertRowid;
    const movement = db.prepare(`
      INSERT INTO stock_movements (occurred_at, delta, reason, kind, batch_ref, created_by)
      VALUES (?, ?, ?, 'tanda', ?, ?)
    `).run(fecha, quantity, `Ingreso por tanda del ${fecha}`, batchId, req.user?.id ?? null);

    return { batchId, movementId: movement.lastInsertRowid };
  });

  try {
    const { batchId, movementId } = insertBatch();
    console.log(`[tandas] tanda #${batchId} (${quantity} u.) → movimiento de stock #${movementId} (+${quantity})`);
    return res.status(201).json({
      message: 'Tanda registrada',
      batch: { id: batchId },
      movement: { id: movementId, delta: quantity },
    });
  } catch (err) {
    console.error('createBatch error:', err);
    return res.status(500).json({ error: 'Error al registrar la tanda.' });
  }
}

function updateBatch(req, res) {
  const { id } = req.params;
  const batch = db.prepare('SELECT id FROM production_batches WHERE id = ?').get(id);
  if (!batch) return res.status(404).json({ error: 'Tanda no encontrada.' });

  const updates = [];
  const values = [];
  const { producedAt, quantity, costTotalClp, notes } = req.body;

  if (producedAt !== undefined) {
    // H-3: mismo criterio que createBatch.
    const fecha = String(producedAt ?? '').trim();
    if (!esFechaValida(fecha)) return res.status(400).json({ error: 'Fecha inválida. Usa el formato AAAA-MM-DD.' });
    updates.push('produced_at = ?');
    values.push(fecha);
  }
  if (quantity !== undefined) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un entero mayor a 0.' });
    }
    if (quantity > MAX_CANTIDAD) {
      return res.status(400).json({ error: `Cantidad fuera de rango (máximo ${MAX_CANTIDAD} por tanda).` });
    }
    updates.push('quantity = ?');
    values.push(quantity);
  }
  if (costTotalClp !== undefined) {
    if (!Number.isInteger(costTotalClp) || costTotalClp < 0) {
      return res.status(400).json({ error: 'El costo total debe ser un entero ≥ 0.' });
    }
    updates.push('cost_total_clp = ?');
    values.push(costTotalClp);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes?.trim() || null);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });

  // ADR-3 / I-1: editar la cantidad de la tanda NO toca el stock, a propósito.
  // Los costos se recalculan, el stock queda donde está. Si el dueño además
  // quiere corregir el stock, es una segunda acción explícita (un movimiento),
  // porque son dos cosas distintas: cuánto costó producir vs. cuántas hay.
  // NO agregar acá un UPDATE/INSERT sobre stock_movements: es el bug que se
  // revisó tres veces.
  db.prepare(`UPDATE production_batches SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return res.json({ message: 'Tanda actualizada', batch: { id: parseInt(id, 10) } });
}

/**
 * QA-16: borrado real de la tanda. Las ventas que apuntaban a ella quedan con
 * batch_id NULL (FK ON DELETE SET NULL, schema.sql) — comportamiento deseado,
 * se conserva la venta pero pierde su atribución a la tanda borrada.
 *
 * ADR-3 / I-1: borrar la tanda saca sus COSTOS de los informes y NADA MÁS. El
 * stock no se mueve: el movimiento de ingreso que creó esta tanda sobrevive
 * (stock_movements.batch_ref no tiene FK, así que ningún CASCADE lo alcanza) y
 * sigue ahí con su motivo "Ingreso por tanda del …". Si el dueño quiere además
 * bajar el stock, borra ese movimiento desde el kardex — otra acción.
 * NO agregar acá un DELETE sobre stock_movements ni una FK "prolija" con
 * ON DELETE CASCADE: era exactamente el bug reportado tres veces.
 */
function deleteBatch(req, res) {
  const { id } = req.params;
  const batch = db.prepare('SELECT id FROM production_batches WHERE id = ?').get(id);
  if (!batch) return res.status(404).json({ error: 'Tanda no encontrada.' });

  db.prepare('DELETE FROM production_batches WHERE id = ?').run(id);
  console.log(`[tandas] tanda #${id} eliminada (costos); el stock NO se movió (ADR-3/I-1)`);
  return res.json({ message: 'Tanda eliminada' });
}

module.exports = { getCurrentBatchId, getAllBatches, createBatch, updateBatch, deleteBatch };
