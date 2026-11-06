/**
 * PLAN-12 (ADR-5): control de pedidos desde Telegram.
 *
 * Recibe los updates del webhook (routes/telegram.routes.js) ya autenticados
 * por secreto. Aquí se aplica la lista blanca de chats y se traduce cada
 * comando o botón a las MISMAS funciones del panel
 * (services/orders.service.js): no hay reglas de stock propias del bot.
 *
 * Entrada SOLO por comandos y botones (ADR-5, D7): no se interpreta texto
 * libre. El único texto que se lee es la respuesta a un paso del flujo guiado
 * /nuevo (nombre, cantidad, teléfono), validado campo por campo.
 *
 * Seguridad:
 * - Chat fuera de la lista blanca → se ignora en silencio (ni siquiera se
 *   responde el callback: no se confirma que el bot exista).
 * - El callback_data lleva solo acción e ID; el estado se relee DENTRO de la
 *   transacción (precondition de updateSale) antes de escribir.
 * - Fuera del bot: borrar pedidos, usuarios, precios y ajustes.
 * - Texto plano siempre (sin parse_mode), igual que notify.js.
 */
const crypto = require('crypto');
const { db } = require('../database/db');
const { getStockBreakdown } = require('../controllers/packs.controller');
const { createSale, updateSale, MAX_HALLACAS } = require('./orders.service');
const { LIVE_ORDER_SQL, reviewState } = require('../utils/orderState');
const { normalizePhone } = require('../utils/phone');
const { callApi, fmtChile } = require('./notify');

// Telegram corta en 4096; se deja margen para el texto que se agrega al editar.
const MAX_TEXT = 3900;
// Un flujo /nuevo o una pregunta de stock sin responder se descarta a los 30 min.
const STATE_TTL_MS = 30 * 60 * 1000;
// Telegram reintenta un update si el webhook no respondió a tiempo.
const SEEN_UPDATES_MAX = 500;
// Inline keyboard de /pedidos: una fila por pedido, con tope para no exceder
// el límite de botones de Telegram.
const MAX_LIST_ROWS = 30;
const MAX_NAME = 100;

const PAY_LABEL = { pagado: 'Pagado', pendiente_pago: 'Pendiente de pago', cortesia: 'Cortesía', cancelado: 'Cancelado' };

/**
 * Lowercases, strips diacritics and collapses whitespace (para comparar nombres).
 * @param {string} s
 * @returns {string}
 */
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * One readable line per order (solo salida: el bot no vuelve a leerla).
 * @param {object} o - orders row.
 * @returns {string} e.g. "#12 Elías — 4 hallacas — Pagado — por entregar"
 */
function formatOrder(o) {
  const bits = [`#${o.id} ${o.customer_name}`, `${o.quantity_hallacas} hallacas`];
  if (o.stock_exempt === 1) bits.push('encargo');
  bits.push(PAY_LABEL[o.status] || o.status);
  bits.push(o.delivered_at ? 'entregado' : 'por entregar');
  return bits.join(' — ');
}

/* ============================== Configuración ============================== */

/**
 * Whitelisted chat ids: TELEGRAM_CHAT_ID ∪ TELEGRAM_ADMIN_CHAT_IDS.
 * Se unen ambos para que los botones del aviso (que llega a TELEGRAM_CHAT_ID)
 * sigan funcionando aunque se configure la lista.
 * @returns {Set<string>}
 */
function allowedChats() {
  const ids = [process.env.TELEGRAM_CHAT_ID, ...(process.env.TELEGRAM_ADMIN_CHAT_IDS || '').split(',')]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return new Set(ids);
}

/**
 * @param {unknown} chatId
 * @returns {boolean}
 */
function isAllowed(chatId) {
  if (chatId === undefined || chatId === null) return false;
  // Se compara como string: el id llega como número en el JSON y como texto en .env.
  return allowedChats().has(String(chatId));
}

/* ============================== Envío ============================== */

/**
 * Splits a long text by lines into chunks under MAX_TEXT.
 * @param {string} text
 * @returns {string[]}
 */
function chunk(text) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > MAX_TEXT) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line.slice(0, MAX_TEXT);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Sends a plain-text reply; the keyboard (if any) goes on the last chunk.
 * @param {string|number} chatId
 * @param {string} text
 * @param {object} [replyMarkup]
 */
async function reply(chatId, text, replyMarkup) {
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i += 1) {
    const last = i === parts.length - 1;
    await callApi('sendMessage', {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...(last && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
}

/**
 * Replaces the text (and keyboard) of the message that held the button.
 * @param {object} message - callback_query.message.
 * @param {string} text
 * @param {object} [replyMarkup] - Omit to remove the keyboard.
 */
async function editMessage(message, text, replyMarkup) {
  await callApi('editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: text.length > 4000 ? `${text.slice(0, 3990)}…` : text,
    disable_web_page_preview: true,
    reply_markup: replyMarkup || { inline_keyboard: [] },
  });
}

/* ============================== Acciones sobre pedidos ============================== */

/** Error that means "nothing to do": the order is already in that state. */
function noop(message) {
  const err = new Error(message);
  err.noop = true;
  return err;
}

/**
 * Order actions shared by commands and buttons. `guard` corre sobre la fila
 * releída bajo el lock; si lanza, no se escribe nada.
 */
const ACTIONS = {
  c: {
    label: 'confirmado',
    input: { confirm: true },
    guard(o) {
      if (o.status === 'cancelado') throw noop(`El pedido #${o.id} está cancelado; no se confirmó.`);
      if (o.confirmed_at) throw noop(`El pedido #${o.id} ya estaba confirmado.`);
    },
  },
  x: {
    label: 'rechazado (cancelado)',
    input: { status: 'cancelado' },
    guard(o) {
      if (o.status === 'cancelado') throw noop(`El pedido #${o.id} ya estaba cancelado.`);
      // Rechazar es para pedidos web sin validar; anular uno confirmado es una
      // decisión de panel, no de un botón que pudo quedar viejo.
      if (o.confirmed_at) throw noop(`El pedido #${o.id} ya está confirmado; para anularlo usa el panel.`);
    },
  },
  p: {
    label: 'pagado',
    input: { status: 'pagado' },
    guard(o) {
      if (o.status === 'cancelado') throw noop(`El pedido #${o.id} está cancelado; no se marcó pagado.`);
      if (o.status === 'pagado') throw noop(`El pedido #${o.id} ya estaba pagado.`);
    },
  },
  u: {
    label: 'pendiente de pago',
    input: { status: 'pendiente_pago' },
    guard(o) {
      if (o.status === 'cancelado') throw noop(`El pedido #${o.id} está cancelado; no se cambió.`);
      if (o.status === 'pendiente_pago') throw noop(`El pedido #${o.id} ya estaba pendiente de pago.`);
    },
  },
  e: {
    label: 'entregado',
    input: { delivered: true },
    guard(o) {
      if (o.status === 'cancelado') throw noop(`El pedido #${o.id} está cancelado; no se marcó entregado.`);
      if (o.delivered_at) throw noop(`El pedido #${o.id} ya estaba entregado.`);
    },
  },
};

/**
 * Reads an order row for display.
 * @param {number} id
 * @returns {object|undefined}
 */
function getOrderRow(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Buttons that still make sense for the order's CURRENT state.
 * @param {object|undefined} o - orders row.
 * @returns {object|undefined} reply_markup, or undefined when nothing applies.
 */
function buttonsFor(o) {
  if (!o || o.status === 'cancelado') return undefined;
  const row1 = [];
  const row2 = [];
  if (!o.confirmed_at) {
    row1.push({ text: '✅ Confirmar', callback_data: `c:${o.id}` });
    row1.push({ text: '✖️ Rechazar', callback_data: `x:${o.id}` });
  }
  if (o.status === 'pendiente_pago') row2.push({ text: '💰 Pagado', callback_data: `p:${o.id}` });
  if (!o.delivered_at && o.stock_exempt === 0) row2.push({ text: '📦 Entregado', callback_data: `e:${o.id}` });
  const rows = [row1, row2].filter((r) => r.length);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/**
 * Applies an order action through updateSale.
 * @param {string} action - Key of ACTIONS.
 * @param {number} id
 * @param {boolean} force - Re-send with force after STOCK_INSUFICIENTE.
 * @returns {{text: string, markup?: object, ok: boolean, toast: string}}
 */
function runAction(action, id, force = false) {
  const def = ACTIONS[action];
  try {
    updateSale(id, { ...def.input, ...(force ? { force: true } : {}) }, { precondition: def.guard, actor: 'telegram' });
    const o = getOrderRow(id);
    return {
      ok: true,
      toast: `#${id} ${def.label}`,
      text: `✅ #${id} ${o.customer_name}: ${def.label}.\n${formatOrder(o)}`,
      markup: buttonsFor(o),
    };
  } catch (err) {
    return describeError(err, id, action);
  }
}

/**
 * Turns a business error into a chat reply (plus the force button when it applies).
 * @param {Error} err
 * @param {number} id
 * @param {string} action
 * @returns {{text: string, markup?: object, ok: boolean, toast: string}}
 */
function describeError(err, id, action) {
  if (err.noop) return { ok: false, toast: 'Sin cambios', text: `ℹ️ ${err.message}`, markup: buttonsFor(getOrderRow(id)) };
  if (err.businessCode === 'STOCK_INSUFICIENTE') {
    const quedaria = err.extra.stock - err.extra.requerido;
    return {
      ok: false,
      toast: 'Stock insuficiente',
      text: `⚠️ #${id}: esto deja el stock en ${quedaria}. ¿Registrar igual?`,
      markup: { inline_keyboard: [[{ text: '⚠️ Registrar igual', callback_data: `${action}:${id}:f` }]] },
    };
  }
  if (err.businessCode === 'PEDIDO_NO_CONFIRMADO') {
    return {
      ok: false,
      toast: 'Falta confirmar',
      text: `⚠️ #${id}: ${err.message}`,
      markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `c:${id}` }]] },
    };
  }
  if (err.statusCode) return { ok: false, toast: 'No aplicado', text: `⚠️ #${id}: ${err.message}` };
  console.error('[telegram] acción falló:', err);
  return { ok: false, toast: 'Error', text: `⚠️ #${id}: error interno; revisa el panel.` };
}

/**
 * Generic "random token" for flows and force questions (fits in callback_data).
 * @returns {string} 12 hex chars.
 */
function newToken() {
  return crypto.randomBytes(6).toString('hex');
}

/* ============================== Pregunta de stock (force) ============================== */

// token → { chatId, input, expiresAt }. En memoria a propósito (ADR-5, D8):
// un reinicio de Render solo obliga a repetir /nuevo; no se pierde un pedido.
const drafts = new Map();

/**
 * Stores a pending forced sale and returns its token.
 * @param {string|number} chatId
 * @param {object} input - createSale input (already with force: true).
 * @returns {string}
 */
function saveDraft(chatId, input) {
  const now = Date.now();
  for (const [k, d] of drafts) if (d.expiresAt <= now) drafts.delete(k);
  const token = newToken();
  drafts.set(token, { chatId: String(chatId), input, expiresAt: now + STATE_TTL_MS });
  return token;
}

/**
 * Takes (and removes) a pending sale. Se borra ANTES de aplicar: un doble
 * toque no puede registrar dos veces.
 * @param {string} token
 * @param {string|number} chatId
 * @returns {object|null}
 */
function takeDraft(token, chatId) {
  const d = drafts.get(token);
  if (!d) return null;
  drafts.delete(token);
  if (d.expiresAt <= Date.now() || d.chatId !== String(chatId)) return null;
  return d;
}

/**
 * Registers a new sale (same rule as the panel's manual sale) and builds the reply.
 * @param {string|number} chatId
 * @param {object} input - createSale input.
 * @returns {{text: string, markup?: object}}
 */
function registerSale(chatId, input) {
  try {
    const { id } = createSale(input, { actor: 'telegram' });
    const o = getOrderRow(id);
    return { text: `✅ Registrado: ${formatOrder(o)}`, markup: buttonsFor(o) };
  } catch (err) {
    if (err.businessCode === 'STOCK_INSUFICIENTE') {
      const quedaria = err.extra.stock - err.extra.requerido;
      const t = saveDraft(chatId, { ...input, force: true });
      return {
        text: `⚠️ ${input.customerName}: ${input.quantityHallacas} hallacas.\nEsto deja el stock en ${quedaria}. ¿Registrar igual?`,
        markup: { inline_keyboard: [[
          { text: '⚠️ Registrar igual', callback_data: `d:${t}:ok` },
          { text: '✖️ No', callback_data: `d:${t}:no` },
        ]] },
      };
    }
    if (err.statusCode) return { text: `⚠️ No se registró: ${err.message}` };
    console.error('[telegram] registro falló:', err);
    return { text: '⚠️ Error interno; revisa el panel.' };
  }
}

/**
 * Callback of the "Registrar igual" question (d:<token>:ok|no).
 * @param {object} cq - callback_query.
 * @param {string} token
 * @param {string} choice - 'ok' or 'no'.
 */
async function handleDraftCallback(cq, token, choice) {
  const chatId = cq.message.chat.id;
  const draft = takeDraft(token, chatId);
  const original = cq.message.text || '';
  if (!draft) {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Expiró o ya se aplicó' });
    return editMessage(cq.message, `${original}\n\n⌛ Esta pregunta expiró o ya se respondió. Usa /nuevo de nuevo.`);
  }
  if (choice !== 'ok') {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'No registrado' });
    return editMessage(cq.message, `${original}\n\n✖️ No se registró.`);
  }
  const r = registerSale(chatId, draft.input);
  await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Listo' });
  return editMessage(cq.message, `${original}\n\n${r.text}`, r.markup);
}

/* ============================== Flujo guiado /nuevo ============================== */

// chatId → { token, step, data, expiresAt }. Un flujo por chat; el token va en
// los botones para que los de un flujo anterior no actúen sobre el actual.
const flows = new Map();

const STEPS = {
  name: '(1/5) ¿Nombre del cliente?',
  qty: '(2/5) ¿Cuántas hallacas? (número entero)',
  phone: '(3/5) Teléfono del cliente (9 dígitos, ej. 912345678) o toca «Sin teléfono».',
  pay: '(4/5) ¿Pagado o pendiente de pago?',
  encargo: '(5/5) ¿Es encargo para la próxima tanda? (un encargo no descuenta stock)',
};

/**
 * Inline keyboard of a flow step.
 * @param {object} f - Flow.
 * @returns {object}
 */
function flowKeyboard(f) {
  const cb = (c) => `n:${f.token}:${c}`;
  const cancel = { text: '✖️ Cancelar', callback_data: cb('no') };
  if (f.step === 'phone') return { inline_keyboard: [[{ text: 'Sin teléfono', callback_data: cb('nophone') }, cancel]] };
  if (f.step === 'pay') {
    return { inline_keyboard: [[{ text: '💰 Pagado', callback_data: cb('pp') }, { text: 'Pendiente de pago', callback_data: cb('pu') }], [cancel]] };
  }
  if (f.step === 'encargo') {
    return { inline_keyboard: [[{ text: 'Sí, encargo', callback_data: cb('e1') }, { text: 'No', callback_data: cb('e0') }], [cancel]] };
  }
  if (f.step === 'confirm') {
    return { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: cb('ok') }, cancel]] };
  }
  return { inline_keyboard: [[cancel]] };
}

/**
 * Summary shown before registering.
 * @param {object} d - Flow data.
 * @returns {string}
 */
function flowSummary(d) {
  const lines = [
    'Resumen del pedido:',
    `Cliente: ${d.name}`,
    `Hallacas: ${d.qty}`,
    `Teléfono: ${d.phone || '(sin teléfono)'}`,
    `Pago: ${PAY_LABEL[d.pay]}`,
    `Encargo: ${d.encargo ? 'sí (no descuenta stock)' : 'no'}`,
  ];
  // Nombre repetido: se avisa con los #ID para no duplicar un pedido por error.
  const dup = db.prepare(`SELECT id, customer_name, quantity_hallacas FROM orders WHERE ${LIVE_ORDER_SQL}`)
    .all().filter((o) => fold(o.customer_name) === fold(d.name));
  if (dup.length) lines.push('', `Ojo: ya existe ${dup.map((o) => `#${o.id} con ${o.quantity_hallacas}`).join(', ')}.`);
  return lines.join('\n');
}

/**
 * Sends the prompt of the flow's current step.
 * @param {string|number} chatId
 * @param {object} f
 */
function askStep(chatId, f) {
  f.expiresAt = Date.now() + STATE_TTL_MS;
  const text = f.step === 'confirm' ? flowSummary(f.data) : STEPS[f.step];
  return reply(chatId, text, flowKeyboard(f));
}

/**
 * Returns the live flow of a chat, dropping it when expired.
 * @param {string|number} chatId
 * @returns {object|null}
 */
function getFlow(chatId) {
  const f = flows.get(String(chatId));
  if (!f) return null;
  if (f.expiresAt <= Date.now()) { flows.delete(String(chatId)); return null; }
  return f;
}

/**
 * /nuevo [nombre cantidad]: starts the guided flow.
 * @param {string|number} chatId
 * @param {string[]} args
 */
function startFlow(chatId, args) {
  const f = { token: newToken(), step: 'name', data: { name: null, qty: null, phone: null, pay: null, encargo: null } };
  // Atajo /nuevo <nombre> <cantidad>: el último argumento debe ser la cantidad.
  if (args.length) {
    const last = args[args.length - 1];
    const name = args.slice(0, -1).join(' ').trim();
    const qty = /^\d+$/.test(last) ? Number(last) : NaN;
    if (!name || !Number.isInteger(qty) || qty < 1 || qty > MAX_HALLACAS || name.length > MAX_NAME) {
      return reply(chatId, `Uso: /nuevo  o  /nuevo <nombre> <cantidad>  (ej. /nuevo Elías 4)`);
    }
    f.data.name = name;
    f.data.qty = qty;
    f.step = 'phone';
  }
  flows.set(String(chatId), f);
  return askStep(chatId, f);
}

/**
 * Text answer to a typed step (nombre, cantidad, teléfono). Cada campo se
 * valida por separado; si no sirve se vuelve a preguntar, no se interpreta.
 * @param {string|number} chatId
 * @param {string} text
 */
function flowText(chatId, text) {
  const f = getFlow(chatId);
  if (!f) {
    return reply(chatId, 'Para registrar un pedido usa /nuevo. Para ver los comandos, /ayuda.');
  }
  const value = text.trim();
  if (f.step === 'name') {
    if (!value || value.length > MAX_NAME) return reply(chatId, `Nombre inválido (1 a ${MAX_NAME} caracteres). ${STEPS.name}`, flowKeyboard(f));
    f.data.name = value;
    f.step = 'qty';
  } else if (f.step === 'qty') {
    const qty = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_HALLACAS) {
      return reply(chatId, `Cantidad inválida (entero de 1 a ${MAX_HALLACAS}). ${STEPS.qty}`, flowKeyboard(f));
    }
    f.data.qty = qty;
    f.step = 'phone';
  } else if (f.step === 'phone') {
    const phone = normalizePhone(value);
    if (!phone) return reply(chatId, `Teléfono inválido. ${STEPS.phone}`, flowKeyboard(f));
    f.data.phone = phone;
    f.step = 'pay';
  } else {
    return reply(chatId, 'Elige con los botones del último mensaje, o /cancelar.');
  }
  return askStep(chatId, f);
}

/**
 * Button of the guided flow (n:<token>:<choice>).
 * @param {object} cq - callback_query.
 * @param {string} token
 * @param {string} choice
 */
async function handleFlowCallback(cq, token, choice) {
  const chatId = cq.message.chat.id;
  const original = cq.message.text || '';
  const f = getFlow(chatId);
  // Botón de un flujo anterior o ya terminado: no hace nada.
  if (!f || f.token !== token) {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Este paso ya no está activo' });
    return editMessage(cq.message, original);
  }
  if (choice === 'no') {
    flows.delete(String(chatId));
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Cancelado' });
    return editMessage(cq.message, `${original}\n\n✖️ Pedido cancelado: no se registró nada.`);
  }
  const valid = {
    phone: ['nophone'], pay: ['pp', 'pu'], encargo: ['e1', 'e0'], confirm: ['ok'],
  }[f.step] || [];
  if (!valid.includes(choice)) {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Este paso ya no está activo' });
    return editMessage(cq.message, original);
  }

  if (choice === 'ok') {
    // Se saca el flujo ANTES de escribir: un doble toque no registra dos veces.
    flows.delete(String(chatId));
    const { data } = f;
    const r = registerSale(chatId, {
      customerName: data.name,
      quantityHallacas: data.qty,
      status: data.pay,
      ...(data.phone ? { customerPhone: data.phone } : {}),
      ...(data.encargo ? { encargo: true } : {}),
    });
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Listo' });
    return editMessage(cq.message, `${original}\n\n${r.text}`, r.markup);
  }

  let chosen;
  if (choice === 'nophone') { f.data.phone = null; f.step = 'pay'; chosen = 'Sin teléfono'; }
  if (choice === 'pp' || choice === 'pu') {
    f.data.pay = choice === 'pp' ? 'pagado' : 'pendiente_pago';
    f.step = 'encargo';
    chosen = PAY_LABEL[f.data.pay];
  }
  if (choice === 'e1' || choice === 'e0') { f.data.encargo = choice === 'e1'; f.step = 'confirm'; chosen = f.data.encargo ? 'Encargo' : 'No es encargo'; }
  await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: chosen });
  await editMessage(cq.message, `${original}\n→ ${chosen}`);
  return askStep(chatId, f);
}

/* ============================== Listados ============================== */

/**
 * /pedidos: active orders, one readable line each, with per-order buttons.
 * Activo = vivo y no cerrado (cerrado = entregado y pagado o cortesía).
 * @returns {{text: string, markup?: object}}
 */
function listActive() {
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE ${LIVE_ORDER_SQL}
      AND NOT (delivered_at IS NOT NULL AND status IN ('pagado', 'cortesia'))
    ORDER BY id
  `).all();
  if (!rows.length) return { text: 'No hay pedidos activos.' };
  const porConfirmar = rows.filter((o) => reviewState(o) === 'por_confirmar');
  const confirmados = rows.filter((o) => reviewState(o) === 'confirmado');
  const out = [];
  if (porConfirmar.length) out.push('Por confirmar:', ...porConfirmar.map(formatOrder));
  if (confirmados.length) {
    if (out.length) out.push('');
    out.push('Confirmados:', ...confirmados.map(formatOrder));
  }
  // Botones por pedido con sufijo ":l": tras la acción se redibuja la lista.
  const keyboard = [];
  for (const o of [...porConfirmar, ...confirmados]) {
    const b = buttonsFor(o);
    if (!b) continue;
    if (keyboard.length >= MAX_LIST_ROWS) { out.push('', `(Botones solo para los primeros ${MAX_LIST_ROWS}; usa /pagado <id>, etc.)`); break; }
    keyboard.push(b.inline_keyboard.flat().map((btn) => ({
      text: `${btn.text.split(' ')[0]} #${o.id}`,
      callback_data: `${btn.callback_data}:l`,
    })));
  }
  return { text: out.join('\n'), markup: keyboard.length ? { inline_keyboard: keyboard } : undefined };
}

/**
 * /pendientes: web orders awaiting confirmation, plus those expired in the last 7 days.
 * @returns {string}
 */
function listPending() {
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE status != 'cancelado' AND confirmed_at IS NULL
      AND expires_at > datetime('now', '-7 days')
    ORDER BY expires_at
  `).all();
  const porConfirmar = rows.filter((o) => reviewState(o) === 'por_confirmar');
  const vencidos = rows.filter((o) => reviewState(o) === 'vencido');
  if (!rows.length) return 'No hay pedidos por confirmar.';
  const out = [];
  if (porConfirmar.length) {
    out.push('Por confirmar:', ...porConfirmar.map((o) => `${formatOrder(o)} — vence ${fmtChile(o.expires_at)}`));
  }
  if (vencidos.length) {
    if (out.length) out.push('');
    out.push('Vencidos (últimos 7 días, no reservan stock):', ...vencidos.map(formatOrder));
  }
  out.push('', 'Confirma con /confirmar <id>.');
  return out.join('\n');
}

/**
 * /stock: the same breakdown the panel shows (ADR-3).
 * @returns {string}
 */
function stockText() {
  const b = getStockBreakdown();
  return [
    `Stock disponible: ${b.stock} hallacas.`,
    `Ingresos ${b.ingresos} − egresos ${b.egresos} − comprometidas ${b.comprometidas}.`,
  ].join('\n');
}

const HELP = [
  'Comandos:',
  '/nuevo — registrar un pedido paso a paso',
  '/nuevo <nombre> <cantidad> — atajo (ej. /nuevo Elías 4)',
  '/pedidos — pedidos activos con su #ID y botones',
  '/pendientes — pedidos web por confirmar y vencidos',
  '/stock — stock disponible',
  '/confirmar <id> — confirma un pedido web',
  '/pagado <id> — marca pagado',
  '/porpagar <id> — vuelve a pendiente de pago',
  '/entregado <id> — marca entregado',
  '/rechazar <id> — cancela un pedido web sin confirmar',
  '/cancelar — descarta el /nuevo en curso',
  '',
  'Con nombres repetidos, opera siempre por #ID.',
].join('\n');

const COMMAND_ACTIONS = { confirmar: 'c', pagado: 'p', porpagar: 'u', entregado: 'e', rechazar: 'x' };

/**
 * Handles a slash command. Cualquier comando distinto de /nuevo descarta el
 * flujo en curso, para que un texto posterior no se tome como respuesta vieja.
 * @param {string|number} chatId
 * @param {string} text
 */
async function handleCommand(chatId, text) {
  const [first, ...args] = text.trim().split(/\s+/);
  // "/pedidos@MiBot" en grupos: el sufijo del bot no es parte del comando.
  const cmd = first.slice(1).split('@')[0].toLowerCase();
  const hadFlow = flows.delete(String(chatId));
  if (cmd === 'nuevo') return startFlow(chatId, args);
  if (cmd === 'cancelar') return reply(chatId, hadFlow ? '✖️ Pedido en curso descartado.' : 'No hay un pedido en curso.');
  const prefix = hadFlow ? '(Se descartó el pedido en curso.)\n\n' : '';
  if (cmd === 'pedidos') {
    const l = listActive();
    return reply(chatId, prefix + l.text, l.markup);
  }
  if (cmd === 'pendientes') return reply(chatId, prefix + listPending());
  if (cmd === 'stock') return reply(chatId, prefix + stockText());
  if (cmd === 'ayuda' || cmd === 'help' || cmd === 'start') return reply(chatId, prefix + HELP);
  const action = COMMAND_ACTIONS[cmd];
  if (action) {
    const id = /^#?\d+$/.test(args[0] || '') ? Number(args[0].replace('#', '')) : null;
    if (!id || !Number.isSafeInteger(id)) return reply(chatId, `${prefix}Uso: /${cmd} <id>  (ej. /${cmd} 12)`);
    if (!getOrderRow(id)) return reply(chatId, `${prefix}⚠️ El pedido #${id} no existe.`);
    const r = runAction(action, id);
    return reply(chatId, prefix + r.text, r.markup);
  }
  return reply(chatId, `${prefix}No conozco /${cmd}.\n\n${HELP}`);
}

/**
 * Handles a button press.
 * @param {object} cq - callback_query.
 */
async function handleCallback(cq) {
  const data = String(cq.data || '');
  const flow = data.match(/^n:([0-9a-f]{12}):(nophone|pp|pu|e1|e0|ok|no)$/);
  if (flow) return handleFlowCallback(cq, flow[1], flow[2]);
  const draft = data.match(/^d:([0-9a-f]{12}):(ok|no)$/);
  if (draft) return handleDraftCallback(cq, draft[1], draft[2]);

  const m = data.match(/^([cxpue]):(\d{1,12})(:f)?(:l)?$/);
  if (!m) {
    return callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Acción no reconocida' });
  }
  const id = Number(m[2]);
  if (!getOrderRow(id)) {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'El pedido ya no existe' });
    return editMessage(cq.message, `${cq.message.text || ''}\n\n→ El pedido #${id} ya no existe.`);
  }
  const r = runAction(m[1], id, Boolean(m[3]));
  await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: r.toast });
  // Desde /pedidos: si la acción se aplicó (o no hacía falta), se redibuja la
  // lista con el estado actual; si pide algo más (force, confirmar), se
  // muestra esa pregunta en su lugar.
  if (m[4] && (r.ok || r.toast === 'Sin cambios')) {
    const l = listActive();
    return editMessage(cq.message, `${r.text}\n\n${l.text}`, l.markup);
  }
  return editMessage(cq.message, `${cq.message.text || ''}\n\n→ ${r.text}`, r.markup);
}

/* ============================== Entrada ============================== */

const seenUpdates = new Set();

/**
 * Processes one Telegram update (already authenticated by the webhook secret).
 * Never throws: errors are logged so the webhook can always answer 200 and
 * Telegram does not retry a poisoned update forever.
 * @param {object} update
 * @returns {Promise<'ignored'|'handled'|'duplicate'>}
 */
async function handleUpdate(update) {
  if (!update || typeof update !== 'object') return 'ignored';
  if (Number.isInteger(update.update_id)) {
    if (seenUpdates.has(update.update_id)) return 'duplicate';
    seenUpdates.add(update.update_id);
    if (seenUpdates.size > SEEN_UPDATES_MAX) seenUpdates.delete(seenUpdates.values().next().value);
  }
  try {
    const cq = update.callback_query;
    if (cq) {
      // Chat ajeno: silencio total, ni siquiera answerCallbackQuery.
      if (!cq.message || !isAllowed(cq.message.chat?.id)) return 'ignored';
      await handleCallback(cq);
      return 'handled';
    }
    const msg = update.message;
    if (!msg || typeof msg.text !== 'string' || !isAllowed(msg.chat?.id)) return 'ignored';
    if (msg.text.trim().startsWith('/')) await handleCommand(msg.chat.id, msg.text);
    else await flowText(msg.chat.id, msg.text);
    return 'handled';
  } catch (err) {
    console.error('[telegram] update falló:', err);
    return 'handled';
  }
}

/** Test helper: clears in-memory state (flows, drafts, seen updates). */
function _reset() {
  drafts.clear();
  flows.clear();
  seenUpdates.clear();
}

module.exports = { handleUpdate, isAllowed, allowedChats, listActive, _reset, _drafts: drafts, _flows: flows };
