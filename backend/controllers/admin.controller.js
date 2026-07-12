const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');
const { getPorVender } = require('./packs.controller');

// Vocabulario del Excel del dueño + 'cancelado' (nuestro, para no borrar filas)
const VALID_STATUSES = ['pagado', 'pendiente_pago', 'pendiente_entrega', 'entregado', 'cortesia', 'cancelado'];
const VALID_PAYMENT_METHODS = ['cuenta_vista', 'efectivo'];

/* ============================== Ventas ============================== */

function getAllOrders(req, res) {
  // LEFT JOIN: los pedidos anónimos (user_id NULL) deben seguir apareciendo.
  // o.customer_name/customer_phone son la fuente de verdad (se guardan en
  // cada pedido); los datos de `users` solo llenan el hueco si faltan.
  const orders = db.prepare(`
    SELECT
      o.id, o.status, o.delivery, o.address, o.date_hint, o.notes, o.total_clp,
      o.quantity_hallacas, o.payment_method, o.source,
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
 * Venta manual del admin (pedidos grandes, cortesías, ventas por WhatsApp que
 * no pasaron por la web). Una fila = una venta, igual que en su Excel: sin
 * order_items, solo el total de hallacas y el monto.
 */
function createManualSale(req, res) {
  const { customerName, customerPhone, quantityHallacas, totalClp, paymentMethod, status, notes, delivery } = req.body;

  const qty = parseInt(quantityHallacas, 10);
  if (!customerName?.trim() || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Cliente y cantidad de hallacas (entero > 0) son requeridos.' });
  }
  const saleStatus = status || 'pendiente_pago';
  if (!VALID_STATUSES.includes(saleStatus)) {
    return res.status(400).json({ error: `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}` });
  }
  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}` });
  }
  // Cortesías van con total 0 (así las registra el dueño en su Excel)
  const total = saleStatus === 'cortesia' ? 0 : (Number.isInteger(totalClp) && totalClp >= 0 ? totalClp : null);

  try {
    const result = db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, quantity_hallacas, total_clp, payment_method, status, notes, delivery, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin')
    `).run(
      customerName.trim(),
      normalizePhone(customerPhone) || null,
      qty,
      total,
      paymentMethod || null,
      saleStatus,
      notes?.trim() || null,
      delivery === 'despacho' ? 'despacho' : 'retiro'
    );
    return res.status(201).json({ message: 'Venta registrada', order: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('createManualSale error:', err);
    return res.status(500).json({ error: 'Error al registrar la venta.' });
  }
}

/** PATCH parcial de una venta: estado, método de pago, total, cantidad, notas. */
function updateOrder(req, res) {
  const { id } = req.params;
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const updates = [];
  const values = [];
  const { status, paymentMethod, totalClp, quantityHallacas, notes, customerName } = req.body;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}` });
    }
    updates.push('status = ?');
    values.push(status);
  }
  if (paymentMethod !== undefined) {
    if (paymentMethod !== null && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ error: `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}` });
    }
    updates.push('payment_method = ?');
    values.push(paymentMethod);
  }
  if (totalClp !== undefined) {
    if (totalClp !== null && (!Number.isInteger(totalClp) || totalClp < 0)) {
      return res.status(400).json({ error: 'Total inválido.' });
    }
    updates.push('total_clp = ?');
    values.push(totalClp);
  }
  if (quantityHallacas !== undefined) {
    const qty = parseInt(quantityHallacas, 10);
    if (!Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: 'Cantidad de hallacas inválida.' });
    }
    updates.push('quantity_hallacas = ?');
    values.push(qty);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes?.trim() || null);
  }
  if (customerName !== undefined) {
    if (!customerName?.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
    updates.push('customer_name = ?');
    values.push(customerName.trim());
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar.' });
  }

  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return res.json({ message: 'Venta actualizada', order: { id: parseInt(id, 10) } });
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
    if (priceClp !== null && (!Number.isInteger(priceClp) || priceClp < 0)) {
      return res.status(400).json({ error: 'Precio inválido (entero ≥ 0, o null para "por encargo").' });
    }
    updates.push('price_clp = ?');
    values.push(priceClp);
  }
  if (isAvailable !== undefined) {
    updates.push('is_available = ?');
    values.push(isAvailable ? 1 : 0);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });

  db.prepare(`UPDATE packs SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return res.json({ message: 'Pack actualizado', pack: { id } });
}

/* ============================== Ajustes ============================== */

function getSettings(req, res) {
  const settings = db.prepare('SELECT price_per_hallaca, cost_per_hallaca, hallacas_producidas FROM settings WHERE id = 1').get();
  return res.json({ settings });
}

function updateSettings(req, res) {
  const updates = [];
  const values = [];
  for (const field of ['price_per_hallaca', 'cost_per_hallaca', 'hallacas_producidas']) {
    const value = req.body[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      return res.status(400).json({ error: `${field} debe ser un entero ≥ 0.` });
    }
    updates.push(`${field} = ?`);
    values.push(value);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });

  db.prepare(`UPDATE settings SET ${updates.join(', ')} WHERE id = 1`).run(...values);
  const settings = db.prepare('SELECT price_per_hallaca, cost_per_hallaca, hallacas_producidas FROM settings WHERE id = 1').get();
  return res.json({ message: 'Ajustes guardados', settings });
}

/* ============================== Reportes ============================== */

/**
 * Réplica de la "Organización de ingresos" del Excel del dueño (misma
 * terminología: total de ventas, por vender, inversión, ganancia neta).
 *
 * - total_de_ventas   = Σ total_clp de ventas vivas (cortesías suman 0;
 *                       'cancelado' queda fuera de todo).
 * - hallacas_vendidas = Σ cantidad de ventas no-cortesía.
 * - por_vender        = producidas − (vendidas + cortesías): las cortesías no
 *                       facturan pero sí consumen stock, igual que en la olla.
 * - inversion         = cost_per_hallaca × hallacas_producidas.
 * - ganancia_neta     = total_de_ventas − inversion.
 */
function getReports(req, res) {
  const settings = db.prepare('SELECT price_per_hallaca, cost_per_hallaca, hallacas_producidas FROM settings WHERE id = 1').get();

  const ventas = db.prepare(`
    SELECT
      COALESCE(SUM(total_clp), 0) AS total_de_ventas,
      COALESCE(SUM(CASE WHEN status != 'cortesia' THEN quantity_hallacas ELSE 0 END), 0) AS hallacas_vendidas,
      COALESCE(SUM(CASE WHEN status = 'cortesia' THEN quantity_hallacas ELSE 0 END), 0) AS hallacas_cortesia,
      COUNT(CASE WHEN status != 'cortesia' THEN 1 END) AS n_ventas
    FROM orders WHERE status != 'cancelado'
  `).get();

  const porMetodo = db.prepare(`
    SELECT COALESCE(payment_method, 'sin_registrar') AS metodo, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE status != 'cancelado'
    GROUP BY payment_method
  `).all();

  const porEstado = db.prepare(`
    SELECT status, COUNT(*) AS n FROM orders GROUP BY status
  `).all();

  // 'localtime' para que el corte de día sea el del negocio y no UTC.
  // En Render conviene fijar TZ=America/Santiago para que coincida con Chile.
  const ventasHoy = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE status != 'cancelado'
      AND date(created_at, 'localtime') = date('now', 'localtime')
  `).get();

  const inversion = settings.cost_per_hallaca * settings.hallacas_producidas;
  const porVender = getPorVender(); // null = contador de producción sin usar

  return res.json({
    reports: {
      total_de_ventas: ventas.total_de_ventas,
      ingresos_por_metodo: Object.fromEntries(porMetodo.map((r) => [r.metodo, r.total])),
      hallacas_vendidas: ventas.hallacas_vendidas,
      hallacas_cortesia: ventas.hallacas_cortesia,
      hallacas_producidas: settings.hallacas_producidas,
      por_vender: porVender,
      inversion,
      ganancia_neta: ventas.total_de_ventas - inversion,
      ticket_promedio: ventas.n_ventas > 0 ? Math.round(ventas.total_de_ventas / ventas.n_ventas) : 0,
      ventas_por_estado: Object.fromEntries(porEstado.map((r) => [r.status, r.n])),
      ventas_hoy: ventasHoy,
    },
  });
}

module.exports = {
  getAllOrders,
  createManualSale,
  updateOrder,
  getAllUsers,
  getPacks,
  updatePack,
  getSettings,
  updateSettings,
  getReports,
};
