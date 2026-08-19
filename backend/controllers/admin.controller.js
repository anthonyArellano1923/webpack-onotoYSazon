const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');
const { getStock, getStockBreakdown } = require('./packs.controller');
const { getCurrentBatchId } = require('./batches.controller');

// Vocabulario del Excel del dueño + 'cancelado' (nuestro, para no borrar filas)
// QA-16: 'entregado'/'pendiente_entrega' salen del enum — la entrega pasa a
// ser su propia columna (delivered_at), no un estado de pago.
// Tope de rango de una venta, alineado con R-5 (checkout), MAX_DELTA
// (movimientos de stock) y MAX_CANTIDAD (tandas).
const MAX_HALLACAS = 10000;

const VALID_STATUSES = ['pagado', 'pendiente_pago', 'cortesia', 'cancelado'];
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
      o.batch_id, o.delivered_at, o.stock_exempt,
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
 *
 * ADR-3: a diferencia del checkout público, esta venta NO se bloquea por stock.
 * El dueño registra la realidad aunque el sistema esté atrasado; si el stock
 * queda negativo se ve en rojo en el panel pidiendo el ajuste.
 */
function createManualSale(req, res) {
  const { customerName, customerPhone, quantityHallacas, totalClp, paymentMethod, status, notes, delivery } = req.body;

  const qty = Number(quantityHallacas);
  if (!customerName?.trim() || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Cliente y cantidad de hallacas (entero > 0) son requeridos.' });
  }
  // H-7 (auditoría 10): la venta manual no se topa por STOCK (a propósito, el
  // dueño registra la realidad), pero sí por rango — una venta de 50.000.000
  // dejaba el stock en −49.999.999 y el catálogo muerto. Mismo tope que R-5.
  if (qty > MAX_HALLACAS) {
    return res.status(400).json({ error: `Cantidad fuera de rango (máximo ${MAX_HALLACAS} por venta).` });
  }
  const saleStatus = status || 'pendiente_pago';
  if (!VALID_STATUSES.includes(saleStatus)) {
    return res.status(400).json({ error: `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}` });
  }
  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}` });
  }
  // QA-H1: teléfono inválido por red se normalizaba a NULL en silencio — ahora 400 explícito.
  // El teléfono sigue siendo opcional (vacío/ausente pasa), pero si viene con
  // contenido no vacío que no normaliza a un móvil chileno válido, se rechaza
  // en vez de guardarse como NULL sin avisar (mismo copy que el alert inline
  // del panel, AdminDashboard.jsx QA-09).
  // QA-H4: customerPhone puede llegar como número JSON por red — String() antes
  // de .trim() para no responder 500 donde corresponde un 400.
  const rawPhone = String(customerPhone ?? '').trim();
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !normalizedPhone) {
    return res.status(400).json({ error: 'Número inválido: 9 dígitos empezando con 9 (ej. 912345678).' });
  }
  // Cortesías van con total 0 (así las registra el dueño en su Excel)
  const total = saleStatus === 'cortesia' ? 0 : (Number.isInteger(totalClp) && totalClp >= 0 ? totalClp : null);

  try {
    // QA-16/ADR-2: la venta manual también se atribuye a la tanda vigente,
    // igual que las ventas web (createOrder), para que los informes por
    // tanda no queden cojos según el canal de venta.
    const batchId = getCurrentBatchId();
    const result = db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, quantity_hallacas, total_clp, payment_method, status, notes, delivery, source, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?)
    `).run(
      customerName.trim(),
      normalizedPhone,
      qty,
      total,
      paymentMethod || null,
      saleStatus,
      notes?.trim() || null,
      delivery === 'despacho' ? 'despacho' : 'retiro',
      batchId
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
  const order = db.prepare(`
    SELECT id, status, total_clp, quantity_hallacas, stock_exempt
    FROM orders WHERE id = ?
  `).get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const updates = [];
  const values = [];
  const {
    status, paymentMethod, totalClp, quantityHallacas, notes, customerName,
    delivered, confirmStock,
  } = req.body;

  if (confirmStock !== undefined && confirmStock !== true) {
    return res.status(400).json({ error: 'confirmStock sólo admite el valor true para concretar un encargo.' });
  }

  const confirmingStock = confirmStock === true;
  if (confirmingStock && order.stock_exempt !== 1) {
    return res.status(409).json({ error: 'Este pedido ya reserva stock o no corresponde a un encargo.' });
  }

  const finalStatus = status ?? order.status;
  const finalQty = quantityHallacas !== undefined ? quantityHallacas : order.quantity_hallacas;
  const finalTotal = finalStatus === 'cortesia'
    ? 0
    : (totalClp !== undefined ? totalClp : order.total_clp);

  if (confirmingStock) {
    if (finalStatus === 'cancelado') {
      return res.status(400).json({ error: 'No se puede concretar stock para un pedido cancelado.' });
    }
    if (!Number.isInteger(finalQty) || finalQty <= 0 || finalQty > MAX_HALLACAS) {
      return res.status(400).json({
        error: `Para concretar el encargo, quantityHallacas debe ser un entero entre 1 y ${MAX_HALLACAS}.`,
      });
    }
    if (!Number.isInteger(finalTotal) || finalTotal < 0) {
      return res.status(400).json({
        error: 'Para concretar el encargo, totalClp debe ser un entero mayor o igual a 0.',
      });
    }
  }

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
  // QA-11: la regla "cortesía ⇒ total 0" solo vivía en el POST de creación
  // (createManualSale); el PATCH la ignoraba y dejaba el total viejo. Este
  // push va DESPUÉS del bloque de totalClp a propósito: si el body trae
  // status:'cortesia' Y totalClp, en el UPDATE ambos `total_clp = ?` quedan
  // en el SET pero SQLite aplica el último, así que gana la cortesía (total
  // 0) — precedencia intencional. Al salir de cortesía el total queda en 0 y
  // no es editable inline en el mismo PATCH (aprobado por Anthony, 2026-07-15,
  // por ahora).
  if (status === 'cortesia') {
    updates.push('total_clp = ?');
    values.push(0);
  }
  if (quantityHallacas !== undefined) {
    const qty = Number(quantityHallacas);
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_HALLACAS) {
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
  // QA-16: la entrega deja de ser un estado (sale del enum) y pasa a ser su
  // propia columna con timestamp. ADR-3: `delivered_at` es dato informativo,
  // NO entra en el cálculo del stock.
  if (delivered !== undefined) {
    updates.push(delivered ? "delivered_at = datetime('now')" : 'delivered_at = NULL');
  }
  if (confirmingStock) {
    // Esta transición es la reserva: getStock() comenzará a restar el pedido.
    // Sólo se permite de 1 → 0, evitando descontarlo dos veces.
    updates.push('stock_exempt = 0');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar.' });
  }

  try {
    const applyUpdate = db.transaction(() => {
      if (confirmingStock || delivered === true) {
        const current = db.prepare('SELECT stock_exempt FROM orders WHERE id = ?').get(id);
        if (!current) {
          const error = new Error('Pedido no encontrado.');
          error.statusCode = 404;
          throw error;
        }
        if (delivered === true && current.stock_exempt === 1 && !confirmingStock) {
          const error = new Error('Confirma el encargo y reserva su stock antes de marcarlo como entregado.');
          error.statusCode = 409;
          throw error;
        }
        if (confirmingStock && current.stock_exempt !== 1) {
          const error = new Error('Este encargo ya fue concretado; no se descontó stock nuevamente.');
          error.statusCode = 409;
          throw error;
        }

        const stock = confirmingStock ? getStock() : null;
        if (confirmingStock && finalQty > stock) {
          const error = new Error(`Stock insuficiente para concretar el encargo: disponibles ${stock}, requeridas ${finalQty}.`);
          error.statusCode = 409;
          throw error;
        }
      }

      db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
    });

    applyUpdate();
    return res.json({
      message: confirmingStock ? 'Encargo concretado y stock reservado' : 'Venta actualizada',
      order: {
        id: parseInt(id, 10),
        ...(confirmingStock ? {
          stock_exempt: 0,
          quantity_hallacas: finalQty,
          total_clp: finalTotal,
        } : {}),
      },
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('updateOrder error:', err);
    return res.status(500).json({ error: 'Error al actualizar la venta.' });
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
  const { id } = req.params;
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
  if (!Number.isInteger(price_per_hallaca) || price_per_hallaca < 0) {
    return res.status(400).json({ error: 'price_per_hallaca debe ser un entero ≥ 0.' });
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
 *                        'cancelado' queda fuera de todo).
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
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
  `).get();

  const porMetodo = db.prepare(`
    SELECT COALESCE(payment_method, 'sin_registrar') AS metodo, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
    GROUP BY payment_method
  `).all();

  const porEstado = db.prepare(`
    SELECT status, COUNT(*) AS n FROM orders WHERE stock_exempt = 0 GROUP BY status
  `).all();

  // QA-17: montos por estado de pago (ventas con total_clp NULL, "a
  // coordinar", no suman en ninguno de los dos).
  const montos = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pagado' THEN total_clp END), 0)         AS monto_pagado,
      COALESCE(SUM(CASE WHEN status = 'pendiente_pago' THEN total_clp END), 0) AS monto_adeudado
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
  `).get();

  // 'localtime' para que el corte de día sea el del negocio y no UTC.
  // En Render conviene fijar TZ=America/Santiago para que coincida con Chile.
  const ventasHoy = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total_clp), 0) AS total
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 0
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
    FROM orders WHERE status != 'cancelado' AND stock_exempt = 1
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
      ventas_por_estado: Object.fromEntries(porEstado.map((r) => [r.status, r.n])),
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
