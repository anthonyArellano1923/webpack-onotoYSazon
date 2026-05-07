const { db } = require('../database/db');

function createOrder(req, res) {
  const { items, delivery, dateHint, notes, total } = req.body;
  const userId = req.user.id;

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

  const insertOrder = db.transaction(() => {
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, delivery, date_hint, notes, total_clp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      userId,
      delivery || 'retiro',
      dateHint?.trim() || null,
      notes?.trim() || null,
      totalClp
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
