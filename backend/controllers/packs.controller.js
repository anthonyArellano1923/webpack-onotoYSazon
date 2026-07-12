const { db } = require('../database/db');

/**
 * Hallacas disponibles para vender según el contador simple de la temporada.
 *
 * `por_vender = hallacas_producidas − hallacas_comprometidas`. Se comprometen
 * las hallacas de toda venta viva (incluye cortesías: también consumen stock);
 * solo 'cancelado' libera. Si `hallacas_producidas` es 0 el contador se
 * considera "sin usar" y devolvemos null (= sin límite), para que el catálogo
 * no aparezca agotado antes de que el dueño configure la producción.
 */
function getPorVender() {
  const settings = db.prepare('SELECT hallacas_producidas FROM settings WHERE id = 1').get();
  if (!settings || settings.hallacas_producidas <= 0) return null;

  const { comprometidas } = db.prepare(`
    SELECT COALESCE(SUM(quantity_hallacas), 0) AS comprometidas
    FROM orders WHERE status != 'cancelado'
  `).get();
  return settings.hallacas_producidas - comprometidas;
}

/** Fila de la BD → forma que consume el frontend (la misma de packs.js). */
function toPublicPack(row, porVender) {
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
    available: row.is_available === 1 && (porVender === null || porVender >= row.qty),
  };
}

function listPublicPacks(req, res) {
  try {
    const porVender = getPorVender();
    const rows = db.prepare('SELECT * FROM packs ORDER BY sort_order').all();
    return res.json({ packs: rows.map((r) => toPublicPack(r, porVender)) });
  } catch (err) {
    console.error('listPublicPacks error:', err);
    return res.status(500).json({ error: 'Error al cargar el catálogo.' });
  }
}

module.exports = { listPublicPacks, getPorVender };
