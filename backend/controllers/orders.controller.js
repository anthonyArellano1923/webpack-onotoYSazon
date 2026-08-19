const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');
const { getCurrentBatchId } = require('./batches.controller');
const { getStock } = require('./packs.controller');

function createOrder(req, res) {
  const { name, phone, items, delivery, address, dateHint, notes, quantityHallacas } = req.body;
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

  // El cliente sólo decide packId + qty. Nombre, precio y unidades por pack se
  // toman del catálogo persistido para que un request manual no pueda alterar
  // el total ni las hallacas comprometidas.
  for (const item of items) {
    if (typeof item?.packId !== 'string' || !item.packId.trim()
      || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99) {
      return res.status(400).json({ error: 'Datos de producto inválidos.' });
    }
  }

  const packIds = [...new Set(items.map((item) => item.packId.trim()))];
  const placeholders = packIds.map(() => '?').join(',');
  const packRows = db.prepare(`
    SELECT id, name, qty, price_clp, is_available
    FROM packs
    WHERE id IN (${placeholders})
  `).all(...packIds);
  const packsById = new Map(packRows.map((pack) => [pack.id, pack]));

  const missingIds = packIds.filter((id) => !packsById.has(id));
  if (missingIds.length > 0) {
    return res.status(400).json({
      error: `Pack inexistente: ${missingIds.join(', ')}. Actualiza el catálogo e intenta nuevamente.`,
    });
  }

  const unavailable = packRows.find((pack) => pack.is_available !== 1);
  if (unavailable) {
    return res.status(400).json({ error: `El pack "${unavailable.name}" no está disponible.` });
  }

  const canonicalItems = items.map((item) => {
    const pack = packsById.get(item.packId.trim());
    return {
      packId: pack.id,
      packName: pack.name,
      qty: item.qty,
      priceAtTime: pack.price_clp,
      unitsPerPack: pack.qty,
    };
  });
  const hasEncargo = canonicalItems.some((item) => item.priceAtTime === null);
  const hasRegularPack = canonicalItems.some((item) => item.priceAtTime !== null);

  // Un pedido mixto no tiene un total ni una reserva inequívocos: el encargo
  // debe coordinarse por separado de los packs que salen del stock actual.
  if (hasEncargo && hasRegularPack) {
    return res.status(400).json({
      error: 'No puedes mezclar packs por encargo con packs de stock. Registra el encargo por separado.',
    });
  }

  const soloPorEncargo = hasEncargo && !hasRegularPack;
  const qtyHallacas = soloPorEncargo
    ? quantityHallacas
    : canonicalItems.reduce((sum, item) => sum + (item.qty * item.unitsPerPack), 0);
  const totalClp = soloPorEncargo
    ? null
    : canonicalItems.reduce((sum, item) => sum + (item.qty * item.priceAtTime), 0);

  // QA-15: sin tope de cantidad, una venta de prueba/errónea podía envenenar
  // el contador de stock para siempre. El backend protege de basura, no de
  // negocios legítimos (esos se coordinan aparte). Los topes de R-5 (10001 acá,
  // 99 por ítem) se conservan tal cual bajo ADR-3.
  // AUDITORÍA CODEX 2026-07-15: Codex agregó el límite inferior; aceptar cero
  // o negativos podía distorsionar el stock derivado al recibir un request manual.
  if (!Number.isInteger(qtyHallacas) || qtyHallacas <= 0 || qtyHallacas > 10000) {
    return res.status(400).json({ error: 'Cantidad fuera de rango; para pedidos así de grandes coordina por WhatsApp.' });
  }

  if (!Number.isSafeInteger(totalClp) && totalClp !== null) {
    return res.status(400).json({ error: 'El total calculado está fuera de rango.' });
  }

  const insertOrder = db.transaction(() => {
    // Validación final dentro de la misma transacción que registra la venta.
    // Así el stock que aprobamos es el que inmediatamente queda reservado.
    if (!soloPorEncargo) {
      const stock = getStock();
      if (qtyHallacas > stock) {
        const error = new Error('No hay stock suficiente para esa cantidad. Elige otro pack o contáctanos para dejar un encargo.');
        error.statusCode = 409;
        throw error;
      }
    }

    const batchId = getCurrentBatchId();
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, customer_name, customer_phone, delivery, address, date_hint, notes, total_clp, quantity_hallacas, source, batch_id, stock_exempt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?)
    `).run(
      userId,
      name.trim(),
      customerPhone,
      delivery || 'retiro',
      delivery === 'despacho' ? (address?.trim() || null) : null,
      dateHint?.trim() || null,
      notes?.trim() || null,
      totalClp,
      qtyHallacas,
      batchId,
      // H-2: el encargo se congela como exento acá — no se descuenta del stock.
      soloPorEncargo ? 1 : 0
    );

    const orderId = orderResult.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, pack_id, pack_name, qty, price_at_time_clp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of canonicalItems) {
      insertItem.run(orderId, item.packId, item.packName, item.qty, item.priceAtTime ?? null);
    }

    return orderId;
  });

  try {
    const orderId = insertOrder();
    return res.status(201).json({
      message: soloPorEncargo
        ? 'Pedido recibido. Te contactaremos para coordinar precio y entrega.'
        : 'Pedido recibido. Te contactaremos pronto para confirmar.',
      // AUDITORÍA CODEX 2026-07-15: Codex alineó la respuesta con el enum
      // persistido; `pending` pertenecía al contrato legado anterior al QA-16.
      order: { id: orderId, status: 'pendiente_pago' },
    });
  } catch (err) {
    if (err.statusCode) {
      console.warn(`[stock] pedido rechazado: pide ${qtyHallacas}, stock ${getStock()}`);
      return res.status(err.statusCode).json({ error: err.message });
    }
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
