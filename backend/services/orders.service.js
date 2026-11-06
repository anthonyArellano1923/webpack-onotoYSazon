/**
 * PLAN-12 (ADR-5): reglas de escritura de ventas, compartidas por el panel
 * (admin.controller.js) y el bot de Telegram (services/telegramBot.js).
 *
 * Antes vivían dentro de los controladores createManualSale y updateOrder. Se
 * extrajeron SIN cambiar mensajes ni reglas para que el bot no duplique el
 * chequeo de stock (D10 de ADR-4): un segundo camino de escritura con su propia
 * copia de la regla terminaría discrepando del panel.
 *
 * Contrato: funciones SÍNCRONAS (better-sqlite3 es síncrono y los tests llaman
 * a los controladores sin await). Todo error de negocio se lanza como
 * httpError; el controlador lo traduce con sendError y el bot con su texto.
 */
const { db } = require('../database/db');
const { normalizePhone } = require('../utils/phone');
const { getStock } = require('../controllers/packs.controller');
const { getCurrentBatchId } = require('../controllers/batches.controller');
const { LIVE_ORDER_SQL } = require('../utils/orderState');
const { httpError } = require('../utils/httpError');
const { isMontoClp, MONTO_RANGE_MSG } = require('../utils/limits');
const { syncOrderLedger, catchUpOrder } = require('./ledger');
const { recordEvent, recordTransitions } = require('./orderEvents');

// Tope de rango de una venta, alineado con R-5 (checkout), MAX_DELTA
// (movimientos de stock) y MAX_CANTIDAD (tandas).
const MAX_HALLACAS = 10000;

// Vocabulario del Excel del dueño + 'cancelado' (nuestro, para no borrar filas)
// QA-16: 'entregado'/'pendiente_entrega' salen del enum — la entrega pasa a
// ser su propia columna (delivered_at), no un estado de pago.
const VALID_STATUSES = ['pagado', 'pendiente_pago', 'cortesia', 'cancelado'];
const VALID_PAYMENT_METHODS = ['cuenta_vista', 'efectivo'];

/**
 * PLAN-11 (D10): 409 cuando una operación del panel aumenta la reserva sin
 * stock suficiente. `requerido` es el INCREMENTO de reserva (no la cantidad
 * total del pedido): el frontend muestra `stock - requerido` como el stock que
 * quedaría si el admin fuerza con `force: true`.
 * @param {number} stock - Current available stock.
 * @param {number} requerido - Reservation increase requested.
 * @returns {Error}
 */
function stockInsuficiente(stock, requerido) {
  return httpError(
    409,
    `Stock insuficiente: disponibles ${stock}, requeridas ${requerido}.`,
    'STOCK_INSUFICIENTE',
    { stock, requerido }
  );
}

/**
 * Registers a manual (admin) sale. Una fila = una venta, igual que en el Excel
 * del dueño: sin order_items, solo el total de hallacas y el monto.
 *
 * PLAN-11 (D7, D8, D10):
 * - Nace CONFIRMADA (confirmed_at = ahora, sin expires_at) y sin el límite
 *   por teléfono: el dueño ya habló con el cliente.
 * - `encargo: true` = encargo para la próxima tanda: stock_exempt = 1, total
 *   opcional, no se chequea stock. Se concreta después con confirmStock.
 * - Si no es encargo y deja el stock negativo → 409 STOCK_INSUFICIENTE, salvo
 *   `force: true` (el dueño "registra la realidad" a sabiendas).
 *
 * @param {object} input - Same fields as the POST /admin/orders body.
 * @param {{actor?: 'admin'|'telegram'}} [opts] - STOCK FASE 2: who registers
 *   it, for order_events (default admin).
 * @returns {{id: number, esEncargo: boolean}}
 * @throws {Error} httpError 400 (invalid input), 409 STOCK_INSUFICIENTE, SQLite errors.
 */
function createSale(input, opts = {}) {
  const {
    customerName, customerPhone, quantityHallacas, totalClp, paymentMethod, status, notes, delivery,
    encargo, force,
  } = input || {};

  // PLAN-11: tipos estrictos; un número en customerName o notes respondía 500.
  if (typeof customerName !== 'string' || !customerName.trim()) {
    throw httpError(400, 'Cliente y cantidad de hallacas (entero > 0) son requeridos.');
  }
  // PLAN-13: solo número o texto de dígitos; Number() aceptaba true, [7], etc.
  const qtyIsNumeric = typeof quantityHallacas === 'number'
    || (typeof quantityHallacas === 'string' && /^\d+$/.test(quantityHallacas.trim()));
  const qty = qtyIsNumeric ? Number(quantityHallacas) : NaN;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw httpError(400, 'Cliente y cantidad de hallacas (entero > 0) son requeridos.');
  }
  // H-7 (auditoría 10): tope de rango — una venta de 50.000.000 dejaba el
  // stock en −49.999.999 y el catálogo muerto. Mismo tope que R-5.
  if (qty > MAX_HALLACAS) {
    throw httpError(400, `Cantidad fuera de rango (máximo ${MAX_HALLACAS} por venta).`);
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    throw httpError(400, 'Las notas deben ser texto.');
  }
  if (encargo !== undefined && typeof encargo !== 'boolean') {
    throw httpError(400, 'encargo debe ser true o false.');
  }
  if (force !== undefined && typeof force !== 'boolean') {
    throw httpError(400, 'force debe ser true o false.');
  }
  // PLAN-13: tipos estrictos; un objeto acá respondía 500 o se guardaba mal.
  if (status !== undefined && status !== null && typeof status !== 'string') {
    throw httpError(400, `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}`);
  }
  if (paymentMethod !== undefined && paymentMethod !== null && typeof paymentMethod !== 'string') {
    throw httpError(400, `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }
  if (customerPhone !== undefined && customerPhone !== null
    && typeof customerPhone !== 'string' && typeof customerPhone !== 'number') {
    throw httpError(400, 'Número inválido: 9 dígitos empezando con 9 (ej. 912345678).');
  }
  // PLAN-13: monto con tope. Vacío ('' o null) = "a coordinar" (total NULL).
  if (totalClp !== undefined && totalClp !== null && totalClp !== '' && !isMontoClp(totalClp)) {
    throw httpError(400, `Total inválido (${MONTO_RANGE_MSG}).`);
  }
  const saleStatus = status || 'pendiente_pago';
  if (!VALID_STATUSES.includes(saleStatus)) {
    throw httpError(400, `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}`);
  }
  // PLAN-11: una venta que nace cancelada no tiene sentido y ensucia reportes.
  if (saleStatus === 'cancelado') {
    throw httpError(400, 'No se puede registrar una venta como cancelada.');
  }
  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw httpError(400, `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }
  // QA-H1/QA-H4: teléfono opcional, pero si viene con contenido inválido se
  // rechaza (400) en vez de guardarse como NULL en silencio. String() antes de
  // .trim() porque puede llegar como número JSON.
  const rawPhone = String(customerPhone ?? '').trim();
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !normalizedPhone) {
    throw httpError(400, 'Número inválido: 9 dígitos empezando con 9 (ej. 912345678).');
  }
  // Cortesías van con total 0 (así las registra el dueño en su Excel)
  const total = saleStatus === 'cortesia' ? 0 : (isMontoClp(totalClp) ? totalClp : null);
  const esEncargo = encargo === true;

  const insertSale = db.transaction(() => {
    // PLAN-11 (D10): chequeo y escritura bajo el mismo lock (.immediate()).
    if (!esEncargo && force !== true) {
      const stock = getStock();
      if (qty > stock) throw stockInsuficiente(stock, qty);
    }
    // QA-16/ADR-2: la venta manual también se atribuye a la tanda vigente,
    // igual que las ventas web, para que los informes por tanda no queden cojos.
    const batchId = getCurrentBatchId();
    // PLAN-11 — INVARIANTE DEL BACKFILL: la venta manual nace con
    // confirmed_at fijado, así que nunca queda con confirmed_at y expires_at
    // ambos en NULL (ver addOrdersReviewColumns en migrate.js).
    const id = db.prepare(`
      INSERT INTO orders (customer_name, customer_phone, quantity_hallacas, total_clp, payment_method, status, notes, delivery, source, batch_id, stock_exempt, confirmed_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, datetime('now'), NULL)
    `).run(
      customerName.trim(),
      normalizedPhone,
      qty,
      total,
      paymentMethod || null,
      saleStatus,
      notes?.trim() || null,
      delivery === 'despacho' ? 'despacho' : 'retiro',
      batchId,
      esEncargo ? 1 : 0
    ).lastInsertRowid;
    // STOCK FASE 2: asiento de la venta en el mismo commit (un encargo no
    // reserva, así que no escribe nada hasta concretarse).
    syncOrderLedger(id);
    const actor = opts.actor || 'admin';
    recordEvent(id, 'creado', actor);
    if (saleStatus === 'pagado') recordEvent(id, 'pagado', actor);
    return id;
  });

  return { id: Number(insertSale.immediate()), esEncargo };
}

/**
 * Partial update of a sale: estado, método de pago, total, cantidad, notas,
 * entrega, concretar encargo (confirmStock) y confirmar pedido web (confirm).
 *
 * PLAN-11 (ADR-4): toda la lógica corre dentro de una transacción
 * .immediate() y relee el pedido ahí adentro, para que la reserva calculada
 * sea la que realmente se escribe. Cualquier operación que AUMENTE la reserva
 * (confirmar un vencido, reactivar un cancelado, subir la cantidad,
 * confirmStock) pasa por el mismo chequeo de stock (D10), salvo `force: true`.
 *
 * PLAN-12 (ADR-5): `opts.precondition` recibe la fila releída DENTRO del lock
 * y puede lanzar un httpError para abortar sin escribir. El bot la usa para que
 * un botón viejo (p. ej. "Pagado" sobre un pedido que otro canceló después)
 * no reactive nada: chequear afuera y escribir después dejaría una carrera.
 *
 * @param {number} id - Order id (already validated as a positive integer).
 * @param {object} input - Same fields as the PATCH /admin/orders/:id body.
 * @param {{precondition?: (order: object) => void, actor?: 'admin'|'telegram'}} [opts]
 *   STOCK FASE 2: `actor` firma los eventos del pedido (default admin).
 * @returns {{finalQty: number, finalTotal: number|null, confirmingStock: boolean}}
 * @throws {Error} httpError 400/404/409 (incl. STOCK_INSUFICIENTE, PEDIDO_NO_CONFIRMADO).
 */
function updateSale(id, input, opts = {}) {
  const {
    status, paymentMethod, totalClp, quantityHallacas, notes, customerName,
    delivered, confirmStock, confirm, force,
  } = input || {};

  // ---- Validación del body (sin tocar la BD) ----
  if (confirmStock !== undefined && confirmStock !== true) {
    throw httpError(400, 'confirmStock sólo admite el valor true para concretar un encargo.');
  }
  if (confirm !== undefined && confirm !== true) {
    throw httpError(400, 'confirm sólo admite el valor true.');
  }
  if (force !== undefined && typeof force !== 'boolean') {
    throw httpError(400, 'force debe ser true o false.');
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    throw httpError(400, `Estado inválido. Opciones: ${VALID_STATUSES.join(', ')}`);
  }
  if (paymentMethod !== undefined && paymentMethod !== null && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw httpError(400, `Método de pago inválido. Opciones: ${VALID_PAYMENT_METHODS.join(', ')}`);
  }
  if (totalClp !== undefined && totalClp !== null && !isMontoClp(totalClp)) {
    throw httpError(400, `Total inválido (${MONTO_RANGE_MSG}).`);
  }
  // PLAN-13: delivered se coerciona por truthiness; "no" marcaba entregado.
  if (delivered !== undefined && typeof delivered !== 'boolean') {
    throw httpError(400, 'delivered debe ser true o false.');
  }
  // PLAN-11: entero estricto ≥ 1. Antes `Number()` aceptaba "7" y 0, y una
  // cantidad 0 dejaba una venta viva que no reservaba nada.
  if (quantityHallacas !== undefined
    && (!Number.isInteger(quantityHallacas) || quantityHallacas < 1 || quantityHallacas > MAX_HALLACAS)) {
    throw httpError(400, `Cantidad de hallacas inválida (entero entre 1 y ${MAX_HALLACAS}).`);
  }
  // PLAN-11: tipos estrictos; antes un número acá respondía 500 en `.trim()`.
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    throw httpError(400, 'Las notas deben ser texto.');
  }
  if (customerName !== undefined && (typeof customerName !== 'string' || !customerName.trim())) {
    throw httpError(400, 'El nombre no puede quedar vacío.');
  }

  const confirmingStock = confirmStock === true;

  // Releída antes y después del UPDATE: la comparación decide los eventos.
  const readForUpdate = db.prepare(`
    SELECT id, status, total_clp, quantity_hallacas, stock_exempt, confirmed_at, expires_at,
           delivered_at, customer_name, source,
           (${LIVE_ORDER_SQL}) AS live,
           COALESCE(expires_at > datetime('now'), 0) AS hold_open
    FROM orders WHERE id = ?
  `);

  const applyUpdate = db.transaction(() => {
    // Releído DENTRO del lock: el estado que decide la reserva es el actual.
    const order = readForUpdate.get(id);
    if (!order) throw httpError(404, 'Pedido no encontrado.');

    // PLAN-12: guardia del llamador sobre el estado actual, bajo el lock.
    if (opts.precondition) opts.precondition(order);

    // STOCK FASE 2: antes de cambiar nada, el ledger se pone al día con el
    // estado ACTUAL. Si la reserva venció sin que nadie lo anotara, acá se
    // escribe su reverso con la fecha del vencimiento; así la confirmación
    // tardía queda como una reactivación con la fecha de hoy.
    catchUpOrder(id);

    if (confirmingStock && order.stock_exempt !== 1) {
      throw httpError(409, 'Este pedido ya reserva stock o no corresponde a un encargo.');
    }

    const finalStatus = status ?? order.status;
    const finalQty = quantityHallacas !== undefined ? quantityHallacas : order.quantity_hallacas;
    const finalTotal = finalStatus === 'cortesia'
      ? 0
      : (totalClp !== undefined ? totalClp : order.total_clp);
    const finalExempt = confirmingStock ? 0 : order.stock_exempt;

    if (confirmingStock) {
      if (finalStatus === 'cancelado') {
        throw httpError(400, 'No se puede concretar stock para un pedido cancelado.');
      }
      if (!Number.isInteger(finalQty) || finalQty <= 0 || finalQty > MAX_HALLACAS) {
        throw httpError(400, `Para concretar el encargo, quantityHallacas debe ser un entero entre 1 y ${MAX_HALLACAS}.`);
      }
      if (!isMontoClp(finalTotal)) {
        throw httpError(400, 'Para concretar el encargo, totalClp debe ser un entero mayor o igual a 0.');
      }
    }

    // PLAN-11 (D2): confirmación explícita (confirm) o implícita (status final
    // pagado/cortesía, o concretar el encargo). Una vez fijado, confirmed_at no
    // se borra. confirmStock confirma porque concretar = el dueño lo validó
    // (D8); sin esto, un encargo web vencido quedaba "concretado" sin reservar
    // nada, y uno por confirmar dejaba de reservar al pasar expires_at.
    const alreadyConfirmed = order.confirmed_at !== null;
    const willConfirm = !alreadyConfirmed
      && (confirm === true || confirmingStock || finalStatus === 'pagado' || finalStatus === 'cortesia');
    const finalConfirmed = alreadyConfirmed || willConfirm;

    // PLAN-11 (D10): reserva antes y después con los valores FINALES.
    const reservaAntes = order.live && order.stock_exempt === 0 ? order.quantity_hallacas : 0;
    const liveAfter = finalStatus !== 'cancelado' && (finalConfirmed || order.hold_open === 1);
    const reservaDespues = liveAfter && finalExempt === 0 ? finalQty : 0;
    if (reservaDespues > reservaAntes && force !== true) {
      const requerido = reservaDespues - reservaAntes;
      const stock = getStock();
      if (stock < requerido) throw stockInsuficiente(stock, requerido);
    }

    if (delivered) {
      if (order.stock_exempt === 1 && !confirmingStock) {
        throw httpError(409, 'Confirma el encargo y reserva su stock antes de marcarlo como entregado.');
      }
      // PLAN-11: no se entrega lo que el dueño no validó. Usa el estado FINAL,
      // así { confirm: true, delivered: true } en un mismo PATCH es válido.
      if (!finalConfirmed) {
        throw httpError(409, 'Confirma el pedido antes de marcarlo como entregado.', 'PEDIDO_NO_CONFIRMADO');
      }
    }

    const updates = [];
    const values = [];
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (paymentMethod !== undefined) { updates.push('payment_method = ?'); values.push(paymentMethod); }
    if (totalClp !== undefined) { updates.push('total_clp = ?'); values.push(totalClp); }
    // QA-11: "cortesía ⇒ total 0" también en el PATCH. Va DESPUÉS de totalClp
    // a propósito: SQLite aplica el último `total_clp = ?` del SET, así que
    // gana la cortesía (precedencia aprobada por Anthony, 2026-07-15).
    if (status === 'cortesia') { updates.push('total_clp = ?'); values.push(0); }
    if (quantityHallacas !== undefined) { updates.push('quantity_hallacas = ?'); values.push(quantityHallacas); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes?.trim() || null); }
    if (customerName !== undefined) { updates.push('customer_name = ?'); values.push(customerName.trim()); }
    // QA-16: la entrega es su propia columna con timestamp. ADR-3: dato
    // informativo, NO entra en el cálculo del stock.
    if (delivered !== undefined) {
      updates.push(delivered ? "delivered_at = datetime('now')" : 'delivered_at = NULL');
    }
    // Esta transición es la reserva: getStock() comenzará a restar el pedido.
    // Sólo se permite de 1 → 0, evitando descontarlo dos veces.
    if (confirmingStock) updates.push('stock_exempt = 0');
    // PLAN-11: confirmar en el mismo UPDATE que el resto de los cambios.
    if (willConfirm) updates.push("confirmed_at = datetime('now')");

    if (updates.length === 0) {
      // `confirm: true` sobre un pedido ya confirmado es idempotente, no error.
      if (confirm === true) return { finalQty, finalTotal };
      throw httpError(400, 'Nada que actualizar.');
    }

    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
    // STOCK FASE 2: asiento de lo que cambió la reserva (cancelar, reactivar,
    // confirmar un vencido, cambiar la cantidad, concretar un encargo), y los
    // eventos que se desprenden de comparar antes y después.
    syncOrderLedger(id);
    recordTransitions(order, readForUpdate.get(id), opts.actor || 'admin');
    return { finalQty, finalTotal };
  });

  const { finalQty, finalTotal } = applyUpdate.immediate();
  return { finalQty, finalTotal, confirmingStock };
}

module.exports = {
  MAX_HALLACAS, VALID_STATUSES, VALID_PAYMENT_METHODS, stockInsuficiente, createSale, updateSale,
};
