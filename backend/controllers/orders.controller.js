const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');
const { getCurrentBatchId } = require('./batches.controller');
const { getStock } = require('./packs.controller');
const { LIVE_ORDER_SQL, holdHours, maxPorTelefono, reviewState } = require('../utils/orderState');
const { CONTACT_SELLER_MSG, httpError, sendError } = require('../utils/httpError');
const notify = require('../services/notify');
const { syncOrderLedger } = require('../services/ledger');
const { recordEvent } = require('../services/orderEvents');

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

  const hours = holdHours();
  const limite = maxPorTelefono();

  // PLAN-11 (M5): .immediate() toma el lock de escritura al empezar. Con una
  // transacción diferida, el límite y el stock leídos podían quedar obsoletos
  // antes del INSERT si otra escritura se colaba entre medio.
  const insertOrder = db.transaction(() => {
    // a) PLAN-11 (D6): máximo de hallacas web activas por teléfono. Cuentan
    // solo pedidos web vivos y no entregados, incluidos los encargos; con
    // sesión, también los del mismo user_id aunque usara otro teléfono.
    const { activas } = db.prepare(`
      SELECT COALESCE(SUM(quantity_hallacas), 0) AS activas FROM orders
      WHERE source = 'web' AND delivered_at IS NULL AND ${LIVE_ORDER_SQL}
        AND (customer_phone = ? OR (? IS NOT NULL AND user_id = ?))
    `).get(customerPhone, userId, userId);
    if (activas + qtyHallacas > limite) {
      throw httpError(409, CONTACT_SELLER_MSG, 'LIMITE_TELEFONO');
    }

    // b) Validación final del stock dentro de la misma transacción que
    // registra la venta: el stock aprobado es el que queda reservado. Los
    // encargos no reservan stock (H-2).
    if (!soloPorEncargo) {
      const stock = getStock();
      if (qtyHallacas > stock) {
        console.warn(`[stock] pedido rechazado: pide ${qtyHallacas}, stock ${stock}`);
        throw httpError(409, CONTACT_SELLER_MSG, 'SIN_STOCK');
      }
    }

    // c) PLAN-11 — INVARIANTE DEL BACKFILL (migrate.js, addOrdersReviewColumns):
    // todo pedido web nace con expires_at NOT NULL y confirmed_at NULL. Si este
    // INSERT dejara ambos en NULL, el backfill del siguiente arranque lo daría
    // por confirmado y reservaría stock para siempre (el bug C1).
    const batchId = getCurrentBatchId();
    const orderResult = db.prepare(`
      INSERT INTO orders (user_id, customer_name, customer_phone, delivery, address, date_hint, notes, total_clp, quantity_hallacas, source, batch_id, stock_exempt, confirmed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, NULL, datetime('now', '+' || ? || ' hours'))
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
      soloPorEncargo ? 1 : 0,
      hours
    );

    const orderId = orderResult.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, pack_id, pack_name, qty, price_at_time_clp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of canonicalItems) {
      insertItem.run(orderId, item.packId, item.packName, item.qty, item.priceAtTime ?? null);
    }

    // STOCK FASE 2: asiento de la reserva y evento "creado" en el mismo commit
    // que el pedido. El checkout lo hace el cliente: actor sistema.
    syncOrderLedger(orderId);
    recordEvent(orderId, 'creado', 'sistema');

    return orderId;
  });

  let order;
  try {
    const orderId = insertOrder.immediate();
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  } catch (err) {
    return sendError(res, err, 'Error al registrar el pedido.', 'createOrder error');
  }

  // PLAN-11 (D11): el aviso va DESPUÉS del commit y sin await: Telegram lento
  // o caído nunca demora ni hace fallar el pedido.
  notify.newOrder(order).catch((err) => console.warn('[notify] newOrder falló:', err.message));

  return res.status(201).json({
    message: soloPorEncargo
      ? 'Pedido recibido. Te contactaremos para coordinar precio y entrega.'
      : `Pedido recibido. Queda reservado por ${hours} h mientras el vendedor lo confirma por WhatsApp.`,
    // AUDITORÍA CODEX 2026-07-15: Codex alineó la respuesta con el enum
    // persistido; `pending` pertenecía al contrato legado anterior al QA-16.
    order: {
      id: order.id,
      status: 'pendiente_pago',
      review: 'por_confirmar',
      expiresAt: order.expires_at,
    },
    holdHours: hours,
  });
}

function getMyOrders(req, res) {
  const userId = req.user.id;

  const orders = db.prepare(`
    SELECT id, status, delivery, date_hint, notes, total_clp, quantity_hallacas,
           confirmed_at, expires_at, created_at, updated_at
    FROM orders WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);

  const getItems = db.prepare(`
    SELECT pack_id, pack_name, qty, price_at_time_clp
    FROM order_items WHERE order_id = ?
  `);

  return res.json({
    // PLAN-11: `review` derivado para que el cliente vea si su pedido sigue
    // por confirmar, ya fue confirmado o venció.
    orders: orders.map((o) => ({ ...o, review: reviewState(o), items: getItems.all(o.id) })),
  });
}

module.exports = { createOrder, getMyOrders };
