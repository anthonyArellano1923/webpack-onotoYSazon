const { db } = require('../database/db');
const { getStock, getStockBreakdown } = require('./packs.controller');
const { esFechaValida } = require('../utils/fecha');

/**
 * ADR-3 (plan 09): el stock es un dato propio que vive en `stock_movements`.
 * Este controlador es su única puerta de escritura.
 *
 *   stock = Σ stock_movements.delta − Σ ventas vivas.quantity_hallacas
 *
 * Las ventas NO se escriben acá: se derivan de `orders` (packs.controller).
 * Y `production_batches` no se consulta en ninguna de estas funciones — borrar
 * o editar una tanda no puede mover el stock (invariante I-1).
 */

// Tope anti-envenenamiento, mismo criterio que R-5 en orders.controller: el
// backend protege de basura (dedos pegados en el teclado, requests manuales),
// no de negocios legítimos. 10.000 hallacas en un solo movimiento no existe.
const MAX_DELTA = 10000;

/**
 * Kardex: movimientos de stock + ventas vivas en una sola lista, por fecha
 * descendente, con saldo corrido. Sólo lectura.
 *
 * El saldo se acumula en orden ascendente (el saldo de una línea es el stock
 * que quedaba justo después de ella) y la lista se devuelve invertida, que es
 * como se lee un kardex: lo más reciente arriba.
 */
function getKardex(req, res) {
  try {
    const movimientos = db.prepare(`
      SELECT id, occurred_at, delta, reason, kind, batch_ref, created_at
      FROM stock_movements
    `).all().map((m) => ({
      tipo: 'movimiento',
      id: m.id,
      fecha: m.occurred_at,
      delta: m.delta,
      motivo: m.reason,
      kind: m.kind,
      batch_ref: m.batch_ref,
      _orden: m.created_at,
    }));

    // Ventas vivas: entran al kardex como consumo (delta negativo) pero NO son
    // filas de stock_movements — son derivadas, y por eso no llevan papelera:
    // se editan desde la pestaña Ventas.
    // date(...,'localtime'): orders.created_at se guarda en UTC y los
    // movimientos en fecha local — sin esto una venta de la tarde aparecía un
    // día adelantada en el kardex. Mismo criterio que ventas_hoy en reportes.
    const ventas = db.prepare(`
      SELECT id, customer_name, quantity_hallacas, status, delivered_at,
             date(created_at, 'localtime') AS fecha, created_at
      FROM orders
      WHERE status != 'cancelado' AND quantity_hallacas > 0 AND stock_exempt = 0
    `).all().map((o) => ({
      tipo: 'venta',
      id: o.id,
      fecha: o.fecha,
      delta: -o.quantity_hallacas,
      motivo: `Pedido de ${o.customer_name || 'cliente'}${o.status === 'cortesia' ? ' (cortesía)' : ''}`,
      kind: 'venta',
      status: o.status,
      delivered_at: o.delivered_at,
      batch_ref: null,
      _orden: o.created_at,
    }));

    const ascendente = [...movimientos, ...ventas].sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      if (a._orden !== b._orden) return a._orden < b._orden ? -1 : 1;
      // H-4 (auditoría 10): `a.id - b.id` comparaba ids de DOS tablas distintas
      // (stock_movements vs orders), así que con el mismo timestamp el orden
      // salía al azar y el saldo corrido mostraba números imposibles (una venta
      // con saldo negativo debajo de un ingreso). Empate → primero el ingreso:
      // no se puede vender lo que todavía no entró.
      if (a.tipo !== b.tipo) return a.tipo === 'movimiento' ? -1 : 1;
      return a.id - b.id;
    });

    let saldo = 0;
    for (const linea of ascendente) {
      saldo += linea.delta;
      linea.saldo = saldo;
      delete linea._orden;
    }

    // H-2: hallacas en encargos (sólo por encargo), fuera del stock — se
    // muestran en una línea aparte del panel.
    const { encargos } = db.prepare(`
      SELECT COALESCE(SUM(quantity_hallacas), 0) AS encargos
      FROM orders WHERE status != 'cancelado' AND stock_exempt = 1
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
  const motivo = String(reason ?? '').trim();
  if (motivo.length < 3) {
    return res.status(400).json({ error: 'El motivo es obligatorio (mínimo 3 caracteres).' });
  }
  // H-3: la fecha ordena el kardex y calcula el saldo corrido — una fecha
  // basura descoloca la tabla entera, así que se valida como el motivo.
  const fecha = String(occurredAt ?? '').trim() || null;
  if (fecha !== null && !esFechaValida(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida. Usa el formato AAAA-MM-DD.' });
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
    'SELECT id, delta, kind, reason FROM stock_movements WHERE id = ?'
  ).get(id);
  if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado.' });

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
