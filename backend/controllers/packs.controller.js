const { db } = require('../database/db');

/**
 * ADR-3 (plan 09, supersede ADR-2): EL STOCK ES UN DATO PROPIO, no una fórmula
 * sobre las tandas.
 *
 *   stock = Σ stock_movements.delta − Σ ventas vivas.quantity_hallacas
 *
 * - `stock_movements` son ingresos/egresos con motivo obligatorio: los crea el
 *   dueño a mano, o el sistema al registrar una tanda (movimiento independiente).
 * - Las ventas se restan DERIVADAS de `orders` (status != 'cancelado', incluye
 *   cortesías: también consumen stock). No escriben movimientos, así cancelar,
 *   borrar o editar una venta ajusta el stock solo.
 * - `production_batches` NO aparece acá, ni debe aparecer nunca: es la tabla de
 *   costos (inversión, costo por hallaca, ganancia, margen). Borrar o editar una
 *   tanda NO puede mover el stock (invariante I-1, revisado tres veces).
 *
 * Devuelve SIEMPRE un entero, que puede ser negativo (más ventas registradas que
 * hallacas ingresadas → el panel lo muestra en rojo pidiendo el ajuste). Se
 * eliminó el `return null` de ADR-2: ya no existe el modo "sin límite" que
 * permitía vender sin stock (invariante I-4).
 */
function getStock() {
  const { movimientos } = db.prepare(`
    SELECT COALESCE(SUM(delta), 0) AS movimientos FROM stock_movements
  `).get();
  const { comprometidas } = db.prepare(`
    SELECT COALESCE(SUM(quantity_hallacas), 0) AS comprometidas
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
  `).get();
  return movimientos - comprometidas;
}

/**
 * Desglose del stock para el panel (ADR-3): de dónde sale el número.
 *
 *   stock = ingresos − egresos − comprometidas
 *
 * `entregadas` se conserva sólo como dato informativo de la pestaña Ventas,
 * FUERA del cálculo. Se eliminaron `producidas` y `stock_fisico`: eran los dos
 * números que salían de tandas y competían entre sí con `por_vender`.
 */
function getStockBreakdown() {
  const movimientos = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta END), 0)  AS ingresos,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta END), 0) AS egresos
    FROM stock_movements
  `).get();
  const { comprometidas } = db.prepare(`
    SELECT COALESCE(SUM(quantity_hallacas), 0) AS comprometidas
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
  `).get();
  const { entregadas } = db.prepare(`
    SELECT COALESCE(SUM(quantity_hallacas), 0) AS entregadas
    FROM orders WHERE delivered_at IS NOT NULL AND status != 'cancelado'
  `).get();

  return {
    ingresos: movimientos.ingresos,
    egresos: movimientos.egresos,
    comprometidas,
    entregadas,
    stock: movimientos.ingresos - movimientos.egresos - comprometidas,
  };
}

/**
 * Fila de la BD → forma que consume el frontend (la misma de packs.js).
 *
 * Los packs "por encargo" (price_clp NULL, ej. "Diciembre completo") quedan
 * EXENTOS del tope de stock: su cantidad y precio se coordinan por WhatsApp,
 * así que el catálogo no debe mostrarlos agotados por falta de stock.
 */
function toPublicPack(row, stock) {
  return {
    id: row.id,
    name: row.name,
    qty: row.qty,
    qtyLabel: row.qty_label,
    price: row.price_clp,
    tag: row.tag,
    tagline: row.tagline,
    description: row.description,
    ingredients: JSON.parse(row.ingredients_json),
    image: row.image,
    available: row.is_available === 1 && (row.price_clp === null || stock >= row.qty),
  };
}

function listPublicPacks(req, res) {
  try {
    const stock = getStock();
    const rows = db.prepare('SELECT * FROM packs ORDER BY sort_order').all();
    return res.json({
      packs: rows.map((r) => toPublicPack(r, stock)),
      stock_available: stock,
    });
  } catch (err) {
    console.error('listPublicPacks error:', err);
    return res.status(500).json({ error: 'Error al cargar el catálogo.' });
  }
}

module.exports = { listPublicPacks, getStock, getStockBreakdown };
