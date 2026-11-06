const { db } = require('../database/db');
const { getStockBreakdown } = require('./packs.controller');
const {
  LIVE_ORDER_SQL, PENDING_REVIEW_SQL, EXPIRED_REVIEW_SQL, reviewState,
} = require('../utils/orderState');
const { sendError, parsePositiveId } = require('../utils/httpError');
const { isMontoClp, MONTO_RANGE_MSG } = require('../utils/limits');
const {
  createSale, updateSale,
} = require('../services/orders.service');

// PLAN-12: vocabulario y topes viven en services/orders.service.js.

/* ============================== Ventas ============================== */

function getAllOrders(req, res) {
  // LEFT JOIN: los pedidos anónimos (user_id NULL) deben seguir apareciendo.
  // o.customer_name/customer_phone son la fuente de verdad (se guardan en
  // cada pedido); los datos de `users` solo llenan el hueco si faltan.
  const orders = db.prepare(`
    SELECT
      o.id, o.status, o.delivery, o.address, o.date_hint, o.notes, o.total_clp,
      o.quantity_hallacas, o.payment_method, o.source,
      o.batch_id, o.delivered_at, o.stock_exempt,
      o.confirmed_at, o.expires_at,
      o.created_at, o.updated_at,
      u.id AS user_id,
      COALESCE(NULLIF(o.customer_name, ''), u.name) AS customer_name,
      u.email AS customer_email,
      COALESCE(o.customer_phone, u.phone) AS customer_phone
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
  `).all();

  const getItems = db.prepare(`
    SELECT pack_id, pack_name, qty, price_at_time_clp
    FROM order_items WHERE order_id = ?
  `);

  return res.json({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      delivery: o.delivery,
      address: o.address,
      date_hint: o.date_hint,
      notes: o.notes,
      total_clp: o.total_clp,
      quantity_hallacas: o.quantity_hallacas,
      payment_method: o.payment_method,
      source: o.source,
      batch_id: o.batch_id,
      delivered_at: o.delivered_at,
      stock_exempt: o.stock_exempt,
      // PLAN-11: el panel arma "Por confirmar" / "Vencidos" con `review`, que
      // se deriva aquí (D2) para no duplicar la regla en el frontend.
      confirmed_at: o.confirmed_at,
      expires_at: o.expires_at,
      review: reviewState(o),
      created_at: o.created_at,
      updated_at: o.updated_at,
      customer: {
        id: o.user_id,
        name: o.customer_name,
        email: o.customer_email,
        phone: o.customer_phone,
      },
      items: getItems.all(o.id),
    })),
  });
}

/**
 * Venta manual del admin (POST /admin/orders).
 * PLAN-12: la regla vive en services/orders.service.js (createSale), compartida
 * con el bot de Telegram; acá solo se traduce a HTTP.
 */
function createManualSale(req, res) {
  try {
    const { id, esEncargo } = createSale(req.body);
    return res.status(201).json({
      message: esEncargo ? 'Encargo registrado para la próxima tanda' : 'Venta registrada',
      order: { id, stock_exempt: esEncargo ? 1 : 0 },
    });
  } catch (err) {
    return sendError(res, err, 'Error al registrar la venta.', 'createManualSale error');
  }
}

/**
 * PATCH parcial de una venta (PATCH /admin/orders/:id).
 * PLAN-12: la regla vive en services/orders.service.js (updateSale), compartida
 * con el bot de Telegram; acá solo se valida el id y se traduce a HTTP.
 */
function updateOrder(req, res) {
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id de pedido inválido.' });

  try {
    const { finalQty, finalTotal, confirmingStock } = updateSale(id, req.body);
    const row = db.prepare('SELECT confirmed_at, expires_at FROM orders WHERE id = ?').get(id);
    return res.json({
      message: confirmingStock ? 'Encargo concretado y stock reservado' : 'Venta actualizada',
      order: {
        id,
        confirmed_at: row.confirmed_at,
        expires_at: row.expires_at,
        review: reviewState(row),
        ...(confirmingStock ? {
          stock_exempt: 0,
          quantity_hallacas: finalQty,
          total_clp: finalTotal,
        } : {}),
      },
    });
  } catch (err) {
    return sendError(res, err, 'Error al actualizar la venta.', 'updateOrder error');
  }
}

/**
 * QA-12: borrado físico de una venta (a diferencia de 'cancelado', que
 * conserva la fila para historial). Pensado para errores/pruebas del admin.
 * order_items cae en cascada (ON DELETE CASCADE, schema.sql) y el stock
 * comprometido se libera automáticamente porque getStock() sólo resta las
 * ventas vivas que existen (ADR-3: las ventas no escriben movimientos).
 */
function deleteOrder(req, res) {
  // PLAN-11: id validado como entero positivo antes de tocar la BD.
  const id = parsePositiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id de pedido inválido.' });
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  return res.json({ message: 'Venta eliminada' });
}

/**
 * QA-12 (ampliado): borrado físico de un usuario. Se bloquean las cuentas
 * admin (403) para no dejar al dueño fuera del panel por accidente. Las
 * ventas del usuario borrado se conservan como anónimas: orders.user_id ya
 * tiene ON DELETE SET NULL y customer_name/customer_phone están
 * desnormalizados en la propia fila de la venta (schema.sql), así que
 * getAllOrders las sigue mostrando vía su COALESCE sin cambios adicionales.
 */
function deleteUser(req, res) {
  const { id } = req.params;
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (user.role === 'admin') {
    return res.status(403).json({ error: 'No se puede borrar una cuenta de administrador desde el panel.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ message: 'Usuario eliminado' });
}

/* ============================== Usuarios ============================== */

function getAllUsers(req, res) {
  // Jamás exponer password_hash: la SELECT enumera columnas explícitamente.
  const users = db.prepare(`
    SELECT id, name, phone, email, address, role, created_at
    FROM users ORDER BY created_at DESC
  `).all();
  return res.json({ users });
}

/* ============================== Packs ============================== */

function getPacks(req, res) {
  const rows = db.prepare('SELECT * FROM packs ORDER BY sort_order').all();
  return res.json({
    packs: rows.map((r) => ({
      id: r.id,
      name: r.name,
      qty: r.qty,
      qty_label: r.qty_label,
      price_clp: r.price_clp,
      is_available: r.is_available,
      sort_order: r.sort_order,
    })),
  });
}

function updatePack(req, res) {
  const { id } = req.params;
  const pack = db.prepare('SELECT id FROM packs WHERE id = ?').get(id);
  if (!pack) return res.status(404).json({ error: 'Pack no encontrado.' });

  const updates = [];
  const values = [];
  const { priceClp, isAvailable } = req.body;

  if (priceClp !== undefined) {
    if (priceClp !== null && !isMontoClp(priceClp)) {
      return res.status(400).json({ error: `Precio inválido (${MONTO_RANGE_MSG}, o null para "por encargo").` });
    }
    updates.push('price_clp = ?');
    values.push(priceClp);
  }
  if (isAvailable !== undefined) {
    // PLAN-13: booleano estricto; antes "false" (texto) quedaba como disponible.
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable debe ser true o false.' });
    }
    updates.push('is_available = ?');
    values.push(isAvailable ? 1 : 0);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });

  db.prepare(`UPDATE packs SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return res.json({ message: 'Pack actualizado', pack: { id } });
}

/* ============================== Ajustes ============================== */

// QA-16: cost_per_hallaca y hallacas_producidas quedan deprecadas por los
// lotes de producción (production_batches) — ya no se leen ni se aceptan
// aquí. Las columnas siguen en la tabla (decisión plan 04, evita un swap),
// pero solo price_per_hallaca queda editable desde Ajustes.
function getSettings(req, res) {
  const settings = db.prepare('SELECT price_per_hallaca FROM settings WHERE id = 1').get();
  return res.json({ settings });
}

function updateSettings(req, res) {
  const { price_per_hallaca } = req.body;
  if (price_per_hallaca === undefined) {
    return res.status(400).json({ error: 'Nada que actualizar.' });
  }
  if (!isMontoClp(price_per_hallaca)) {
    return res.status(400).json({ error: `price_per_hallaca debe ser un ${MONTO_RANGE_MSG}.` });
  }

  db.prepare('UPDATE settings SET price_per_hallaca = ? WHERE id = 1').run(price_per_hallaca);
  const settings = db.prepare('SELECT price_per_hallaca FROM settings WHERE id = 1').get();
  return res.json({ message: 'Ajustes guardados', settings });
}

/* ============================== Reportes ============================== */

/**
 * Réplica de la "Organización de ingresos" del Excel del dueño (misma
 * terminología: total de ventas, por vender, inversión, ganancia neta) +
 * QA-17/QA-19: montos por estado de pago y las dos métricas de ganancia
 * aprobadas por Anthony (2026-07-15).
 *
 * - total_de_ventas    = Σ total_clp de ventas vivas (cortesías suman 0;
 *                        'cancelado' queda fuera de todo). PLAN-11: "vivas"
 *                        = LIVE_ORDER_SQL; un pedido web vencido no cuenta.
 * - hallacas_vendidas  = Σ cantidad de ventas no-cortesía.
 * - stock              = Σ stock_movements.delta − ventas vivas (ADR-3, plan
 *                        09). ENTERO SIEMPRE, puede ser negativo, nunca null.
 *                        No se deriva de production_batches (invariante I-1);
 *                        reemplaza a `por_vender`, y con él salen del payload
 *                        `hallacas_producidas` y `stock_fisico`.
 * - inversion          = Σ cost_total_clp de production_batches — plata
 *                        REALMENTE gastada (QA-19: ya no sale de settings,
 *                        que eran dos números configurados a mano). Las
 *                        fórmulas de plata SIGUEN leyendo production_batches:
 *                        es exactamente para lo que sirve esa tabla.
 * - costo_promedio     = inversion / producidas (0 si no hay lotes).
 * - ganancia_neta      = total_de_ventas − inversion (flujo de caja de la
 *                        temporada completa; negativa a mitad de temporada
 *                        es normal, significa que aún no se recupera lo
 *                        invertido — se MANTIENE esta fórmula).
 * - margen_vendido     = total_de_ventas − (costo_promedio × vendidas)
 *                        (NUEVO QA-19: margen sobre lo ya vendido, la
 *                        pregunta útil a mitad de temporada).
 * - monto_pagado/adeudado (QA-17): posible recién con el enum limpio, donde
 *   status ya no mezcla pago con entrega. Ventas con total_clp NULL ("a
 *   coordinar") no suman en ninguno de los dos.
 */
function getReports(req, res) {
  const ventas = db.prepare(`
    SELECT
      COALESCE(SUM(total_clp), 0) AS total_de_ventas,
      COALESCE(SUM(CASE WHEN status != 'cortesia' THEN quantity_hallacas ELSE 0 END), 0) AS hallacas_vendidas,
      COALESCE(SUM(CASE WHEN status = 'cortesia' THEN quantity_hallacas ELSE 0 END), 0) AS hallacas_cortesia,
      COUNT(CASE WHEN status = 'cortesia' THEN 1 END) AS cantidad_cortesias,
      COUNT(CASE WHEN status != 'cortesia' THEN 1 END) AS n_ventas
    FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 0
  `).get();

  const porMetodo = db.prepare(`
    SELECT COALESCE(payment_method, 'sin_registrar') AS metodo, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 0
    GROUP BY payment_method
  `).all();

  const porEstado = db.prepare(`
    SELECT status, COUNT(*) AS n FROM orders WHERE stock_exempt = 0 GROUP BY status
  `).all();

  // PLAN-11: pedidos web aún sin validar y vencidos (incluye encargos web:
  // también esperan la confirmación del dueño). Cancelados no cuentan.
  const porConfirmar = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(quantity_hallacas), 0) AS hallacas
    FROM orders WHERE ${PENDING_REVIEW_SQL}
  `).get();
  const vencidos = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(quantity_hallacas), 0) AS hallacas
    FROM orders WHERE ${EXPIRED_REVIEW_SQL}
  `).get();

  // QA-17: montos por estado de pago (ventas con total_clp NULL, "a
  // coordinar", no suman en ninguno de los dos).
  const montos = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pagado' THEN total_clp END), 0)         AS monto_pagado,
      COALESCE(SUM(CASE WHEN status = 'pendiente_pago' THEN total_clp END), 0) AS monto_adeudado
    FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 0
  `).get();

  // 'localtime' para que el corte de día sea el del negocio y no UTC.
  // En Render conviene fijar TZ=America/Santiago para que coincida con Chile.
  const ventasHoy = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 0
      AND date(created_at, 'localtime') = date('now', 'localtime')
  `).get();

  const lotes = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS producidas, COALESCE(SUM(cost_total_clp), 0) AS inversion
    FROM production_batches
  `).get();
  const costoPromedio = lotes.producidas > 0 ? lotes.inversion / lotes.producidas : 0;

  // ADR-3: el stock sale de stock_movements, NO de `lotes` (que sigue arriba
  // sólo para las fórmulas de plata). `hallacas_producidas` y `stock_fisico`
  // salen del payload: eran los dos números derivados de tandas que competían
  // con el stock real.
  const stock = getStockBreakdown();

  // H-2: hallacas de pedidos sólo-por-encargo, que NO descuentan del stock —
  // se muestran aparte en el panel ("Encargos por coordinar").
  const { encargos } = db.prepare(`
    SELECT COALESCE(SUM(quantity_hallacas), 0) AS encargos
    FROM orders WHERE ${LIVE_ORDER_SQL} AND stock_exempt = 1
  `).get();

  return res.json({
    reports: {
      total_de_ventas: ventas.total_de_ventas,
      ingresos_por_metodo: Object.fromEntries(porMetodo.map((r) => [r.metodo, r.total])),
      hallacas_vendidas: ventas.hallacas_vendidas,
      hallacas_cortesia: ventas.hallacas_cortesia,
      cantidad_cortesias: ventas.cantidad_cortesias,
      stock: stock.stock,
      stock_ingresos: stock.ingresos,
      stock_egresos: stock.egresos,
      stock_comprometidas: stock.comprometidas,
      encargos_por_coordinar: encargos,
      hallacas_entregadas: stock.entregadas,
      inversion: lotes.inversion,
      costo_por_hallaca_promedio: Math.round(costoPromedio),
      ganancia_neta: ventas.total_de_ventas - lotes.inversion,
      margen_vendido: Math.round(ventas.total_de_ventas - (costoPromedio * ventas.hallacas_vendidas)),
      monto_pagado: montos.monto_pagado,
      monto_adeudado: montos.monto_adeudado,
      ticket_promedio: ventas.n_ventas > 0 ? Math.round(ventas.total_de_ventas / ventas.n_ventas) : 0,
      // PLAN-11: porEstado suma además los contadores de revisión.
      ventas_por_estado: {
        ...Object.fromEntries(porEstado.map((r) => [r.status, r.n])),
        por_confirmar: porConfirmar.n,
        vencidos: vencidos.n,
      },
      por_confirmar: porConfirmar,
      vencidos,
      ventas_hoy: ventasHoy,
    },
  });
}

module.exports = {
  getAllOrders,
  createManualSale,
  updateOrder,
  deleteOrder,
  getAllUsers,
  deleteUser,
  getPacks,
  updatePack,
  getSettings,
  updateSettings,
  getReports,
};
