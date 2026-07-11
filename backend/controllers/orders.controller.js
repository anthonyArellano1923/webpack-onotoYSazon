const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');

function createOrder(req, res) {
  const { name, phone, items, delivery, address, dateHint, notes, total, quantityHallacas } = req.body;
  // Checkout sin login: si hay sesión (optionalAuth) el pedido queda asociado,
  // si no, queda anónimo pero igual persistido con customer_name/customer_phone.
  const userId = req.user?.id ?? null;
  const customerPhone = normalizePhone(phone);

  if (!name?.trim() || !customerPhone) {
    return res.status(400).json({ error: 'Nombre y teléfono son requeridos.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debes incluir al menos un producto.' });
  }

  // Verificar que todos los items tienen los campos necesarios
  for (const item of items) {
    if (!item.packId || !item.packName || !item.qty || item.qty < 1) {
      return res.status(400).json({ error: 'Datos de producto inválidos.' });
    }
  }

  const hasConsulta = items.some((it) => it.priceAtTime == null);
  const totalClp = hasConsulta ? null : (typeof total === 'number' ? total : null);
  // Sin tabla `packs` en el backend todavía, confiamos en el total de hallacas
  // que calculó el frontend (misma confianza que ya se le da a `total`).
  const qtyHallacas = Number.isInteger(quantityHallacas) ? quantityHallacas : 0;

  const insertOrder = db.transaction(() => {
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, customer_name, customer_phone, delivery, address, date_hint, notes, total_clp, quantity_hallacas, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')
    `).run(
      userId,
      name.trim(),
      customerPhone,
      delivery || 'retiro',
      delivery === 'despacho' ? (address?.trim() || null) : null,
      dateHint?.trim() || null,
      notes?.trim() || null,
      totalClp,
      qtyHallacas
    );

    const orderId = orderResult.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, pack_id, pack_name, qty, price_at_time_clp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(orderId, item.packId, item.packName, item.qty, item.priceAtTime ?? null);
    }

    return orderId;
  });

  try {
    const orderId = insertOrder();
    return res.status(201).json({
      message: hasConsulta
        ? 'Pedido recibido. Te contactaremos para coordinar precio y entrega.'
        : 'Pedido recibido. Te contactaremos pronto para confirmar.',
      order: { id: orderId, status: 'pending' },
    });
  } catch (err) {
    console.error('createOrder error:', err);
    return res.status(500).json({ error: 'Error al registrar el pedido.' });
  }
}

function getMyOrders(req, res) {
  const userId = req.user.id;

  const orders = db.prepare(`
    SELECT id, status, delivery, date_hint, notes, total_clp, created_at, updated_at
    FROM orders WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);

  const getItems = db.prepare(`
    SELECT pack_id, pack_name, qty, price_at_time_clp
    FROM order_items WHERE order_id = ?
  `);

  return res.json({
    orders: orders.map((o) => ({ ...o, items: getItems.all(o.id) })),
  });
}

module.exports = { createOrder, getMyOrders };
