const { db } = require('../database/db');

const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];

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

function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}`,
    });
  }

  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado.' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);

  return res.json({ message: 'Estado actualizado', order: { id: parseInt(id), status } });
}

module.exports = { getAllOrders, updateOrderStatus };
