/**
 * PLAN-12 (ADR-5): control de pedidos desde Telegram.
 *
 * Recibe los updates del webhook (routes/telegram.routes.js) ya autenticados
 * por secreto. Aquí se aplica la lista blanca de chats y se traduce cada
 * comando, mensaje o botón a las MISMAS funciones del panel
 * (services/orders.service.js): no hay reglas de stock propias del bot.
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
const { createSale, updateSale } = require('./orders.service');
const { LIVE_ORDER_SQL, reviewState } = require('../utils/orderState');
const { callApi, fmtChile } = require('./notify');
const { fold, parseMessage, formatOrderLine, PAY_LABEL } = require('./telegramParser');

// Telegram corta en 4096; se deja margen para el texto que se agrega al editar.
const MAX_TEXT = 3900;
// Un borrador sin confirmar se descarta a los 30 min (ver ADR-5: memoria).
const DRAFT_TTL_MS = 30 * 60 * 1000;
// Telegram reintenta un update si el webhook no respondió a tiempo.
const SEEN_UPDATES_MAX = 500;

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
    updateSale(id, { ...def.input, ...(force ? { force: true } : {}) }, { precondition: def.guard });
    const o = getOrderRow(id);
    return {
      ok: true,
      toast: `#${id} ${def.label}`,
      text: `✅ #${id} ${o.customer_name}: ${def.label}.\n${formatOrderLine(o)}`,
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

/* ============================== Borradores (formato de Notas) ============================== */

// token → { chatId, items, expiresAt }. En memoria a propósito (ADR-5): un
// reinicio de Render solo obliga a reenviar el mensaje; no se pierde un pedido.
const drafts = new Map();

/**
 * Stores a draft and returns its token (fits in the 64-byte callback_data).
 * @param {string|number} chatId
 * @param {Array<object>} items
 * @returns {string}
 */
function saveDraft(chatId, items) {
  const now = Date.now();
  for (const [k, d] of drafts) if (d.expiresAt <= now) drafts.delete(k);
  const token = crypto.randomBytes(6).toString('hex');
  drafts.set(token, { chatId: String(chatId), items, expiresAt: now + DRAFT_TTL_MS });
  return token;
}

/**
 * Takes (and removes) a draft. Se borra ANTES de aplicar: un doble toque en
 * "Confirmar" no puede registrar dos veces.
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
 * Human label of a parsed line, in the Notes format.
 * @param {object} p - Parsed line.
 * @returns {string}
 */
function describeParsed(p) {
  const bits = [];
  if (p.qty !== null) bits.push(`${p.qty} hallacas`);
  if (p.encargo) bits.push('encargo');
  if (p.pay) bits.push(PAY_LABEL[p.pay].toLowerCase());
  if (p.delivered !== null) bits.push(p.delivered ? 'entregado' : 'por entregar');
  if (p.phone) bits.push(p.phone);
  return bits.join(', ');
}

/**
 * Validates a `#ID` line against the DB and builds the updateSale input.
 * Nombre, cantidad y encargo deben coincidir: si no, se señala y no se aplica
 * (el dueño pudo equivocarse de ID).
 * @param {object} p - Parsed line with id.
 * @returns {{error?: string, input?: object, label?: string, unchanged?: boolean}}
 */
function planUpdate(p) {
  const o = getOrderRow(p.id);
  if (!o) return { error: `#${p.id} no existe` };
  if (o.status === 'cancelado') return { error: `#${p.id} está cancelado` };
  if (p.name && fold(p.name) !== fold(o.customer_name)) {
    return { error: `#${p.id} es de «${o.customer_name}», no de «${p.name}»` };
  }
  if (p.qty !== null && p.qty !== o.quantity_hallacas) {
    return { error: `#${p.id} tiene ${o.quantity_hallacas} hallacas, no ${p.qty} (cámbialo en el panel)` };
  }
  if (p.encargo && o.stock_exempt !== 1) return { error: `#${p.id} no es un encargo` };
  if (p.phone) return { error: `#${p.id}: el teléfono se cambia en el panel` };

  const input = {};
  if (p.pay && p.pay !== o.status) input.status = p.pay;
  if (p.delivered === true && !o.delivered_at) input.delivered = true;
  if (p.delivered === false && o.delivered_at) input.delivered = false;
  const label = `#${o.id} ${o.customer_name}: ${describeParsed({ ...p, qty: null, encargo: false })}`;
  if (Object.keys(input).length === 0) return { unchanged: true, label };
  return { input, label };
}

/**
 * Handles a message in the Notes format: replies with a summary and
 * Confirmar/Cancelar buttons. Nothing is written until the owner confirms.
 * @param {string|number} chatId
 * @param {string} text
 */
async function handleNotes(chatId, text) {
  const lines = parseMessage(text);
  const items = [];
  const shown = [];
  const problems = [];
  const ignored = [];

  for (const l of lines) {
    if (l.kind === 'header') { ignored.push(`  línea ${l.n}: «${l.raw}» (encabezado)`); continue; }
    if (l.kind === 'error') { problems.push(`  línea ${l.n}: «${l.raw}» → ${l.reason}`); continue; }
    if (l.id !== null) {
      const plan = planUpdate(l);
      if (plan.error) { problems.push(`  línea ${l.n}: ${plan.error}`); continue; }
      if (plan.unchanged) { ignored.push(`  línea ${l.n}: ${plan.label} (sin cambios)`); continue; }
      items.push({ kind: 'update', id: l.id, input: plan.input, label: plan.label });
      shown.push(`${items.length}. Actualizar ${plan.label}`);
      continue;
    }
    const input = {
      customerName: l.name,
      quantityHallacas: l.qty,
      status: l.pay || 'pendiente_pago',
      ...(l.phone ? { customerPhone: l.phone } : {}),
      ...(l.encargo ? { encargo: true } : {}),
    };
    const label = `${l.name}: ${describeParsed({ ...l, pay: input.status, delivered: l.delivered === true })}`;
    // Pegar dos veces la misma lista duplicaría pedidos: se avisa, no se adivina.
    const dup = db.prepare(`SELECT id, customer_name, quantity_hallacas FROM orders WHERE ${LIVE_ORDER_SQL}`)
      .all().filter((o) => fold(o.customer_name) === fold(l.name));
    const warn = dup.length ? ` (ojo: ya existe ${dup.map((o) => `#${o.id} con ${o.quantity_hallacas}`).join(', ')})` : '';
    items.push({ kind: 'new', input, delivered: l.delivered === true, label });
    shown.push(`${items.length}. Nuevo: ${label}${warn}`);
  }

  const out = [];
  if (items.length) out.push(`Voy a registrar ${items.length} ${items.length === 1 ? 'cambio' : 'cambios'}:`, ...shown);
  if (problems.length) out.push('', 'No entendí (no se aplica):', ...problems);
  if (ignored.length) out.push('', 'Ignoradas:', ...ignored);
  if (!items.length) {
    if (!problems.length) out.push('Nada que registrar.');
    out.push('', 'Formato: «Nombre: 4. Pagado. Por entregar.» — /ayuda para más.');
    return reply(chatId, out.join('\n'));
  }
  const token = saveDraft(chatId, items);
  return reply(chatId, out.join('\n'), {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `d:${token}:ok` },
      { text: '✖️ Cancelar', callback_data: `d:${token}:no` },
    ]],
  });
}

/**
 * Applies one draft item. A new sale and its "entregado" mark go in ONE
 * transaction (savepoints anidados de better-sqlite3), así no queda media venta.
 * @param {object} item
 * @returns {{line: string, forceItem?: object, quedaria?: number}}
 */
function applyItem(item) {
  try {
    if (item.kind === 'new') {
      const id = db.transaction(() => {
        const created = createSale(item.input);
        if (item.delivered) updateSale(created.id, { delivered: true });
        return created.id;
      })();
      return { line: `✅ #${id} ${item.label}` };
    }
    updateSale(item.id, item.input, {
      precondition(o) {
        // Revalida al aplicar: pudo cancelarse entre el resumen y el botón.
        if (o.status === 'cancelado') throw noop(`#${o.id} se canceló mientras tanto; no se cambió.`);
      },
    });
    return { line: `✅ ${item.label}` };
  } catch (err) {
    if (err.businessCode === 'STOCK_INSUFICIENTE') {
      return {
        line: `⚠️ ${item.label}: stock insuficiente (pregunto aparte)`,
        forceItem: { ...item, input: { ...item.input, force: true } },
        quedaria: err.extra.stock - err.extra.requerido,
      };
    }
    if (err.noop || err.statusCode) return { line: `⚠️ ${item.label}: ${err.message}` };
    console.error('[telegram] borrador falló:', err);
    return { line: `⚠️ ${item.label}: error interno; revisa el panel.` };
  }
}

/**
 * Callback of a draft button (d:<token>:ok|no).
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
    return editMessage(cq.message, `${original}\n\n⌛ Este resumen expiró o ya se aplicó. Reenvía el mensaje.`);
  }
  if (choice !== 'ok') {
    await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Cancelado' });
    return editMessage(cq.message, `${original}\n\n✖️ Cancelado: no se registró nada.`);
  }

  const results = draft.items.map(applyItem);
  await callApi('answerCallbackQuery', { callback_query_id: cq.id, text: 'Aplicado' });
  await editMessage(cq.message, `${original}\n\nResultado:\n${results.map((r) => r.line).join('\n')}`);
  // Una pregunta por línea sin stock, con su propio borrador forzado.
  for (const r of results.filter((x) => x.forceItem)) {
    const t = saveDraft(chatId, [r.forceItem]);
    await reply(chatId, `«${r.forceItem.label}»\nEsto deja el stock en ${r.quedaria}. ¿Registrar igual?`, {
      inline_keyboard: [[
        { text: '⚠️ Registrar igual', callback_data: `d:${t}:ok` },
        { text: '✖️ No', callback_data: `d:${t}:no` },
      ]],
    });
  }
  return undefined;
}

/* ============================== Listados ============================== */

/**
 * /pedidos: active orders in the Notes format, grouped by review state.
 * Activo = vivo y no cerrado (cerrado = entregado y pagado o cortesía).
 * @returns {string}
 */
function listActive() {
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE ${LIVE_ORDER_SQL}
      AND NOT (delivered_at IS NOT NULL AND status IN ('pagado', 'cortesia'))
    ORDER BY id
  `).all();
  if (!rows.length) return 'No hay pedidos activos.';
  const porConfirmar = rows.filter((o) => reviewState(o) === 'por_confirmar');
  const confirmados = rows.filter((o) => reviewState(o) === 'confirmado');
  const out = [];
  // Los títulos terminan en ":" para que, si el dueño reenvía el bloque, el
  // parser los tome como encabezados y no como líneas inválidas.
  if (porConfirmar.length) out.push('Por confirmar:', ...porConfirmar.map(formatOrderLine));
  if (confirmados.length) {
    if (out.length) out.push('');
    out.push('Confirmados:', ...confirmados.map(formatOrderLine));
  }
  return out.join('\n');
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
    out.push('Por confirmar:', ...porConfirmar.map((o) => `${formatOrderLine(o)} Vence ${fmtChile(o.expires_at)}.`));
  }
  if (vencidos.length) {
    if (out.length) out.push('');
    out.push('Vencidos (últimos 7 días, no reservan stock):', ...vencidos.map(formatOrderLine));
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
  '/pedidos — pedidos activos con su #ID',
  '/pendientes — pedidos web por confirmar y vencidos',
  '/stock — stock disponible',
  '/confirmar <id> — confirma un pedido web',
  '/pagado <id> — marca pagado',
  '/porpagar <id> — vuelve a pendiente de pago',
  '/entregado <id> — marca entregado',
  '/rechazar <id> — cancela un pedido web sin confirmar',
  '',
  'Registrar pedidos (una o varias líneas):',
  'Elías: 4. Pagado. Por entregar.',
  'Bryan Toloza: 2. Pendiente de pago. 912345678',
  'Ana: 30. Encargo.',
  '',
  'Cambiar un pedido existente (con nombres repetidos, siempre por #ID):',
  '#12: Pagado. Entregado.',
  '',
  'Siempre te muestro un resumen con Confirmar/Cancelar antes de aplicar.',
].join('\n');

const COMMAND_ACTIONS = { confirmar: 'c', pagado: 'p', porpagar: 'u', entregado: 'e', rechazar: 'x' };

/**
 * Handles a slash command.
 * @param {string|number} chatId
 * @param {string} text
 */
async function handleCommand(chatId, text) {
  const [first, ...args] = text.trim().split(/\s+/);
  // "/pedidos@MiBot" en grupos: el sufijo del bot no es parte del comando.
  const cmd = first.slice(1).split('@')[0].toLowerCase();
  if (cmd === 'pedidos') return reply(chatId, listActive());
  if (cmd === 'pendientes') return reply(chatId, listPending());
  if (cmd === 'stock') return reply(chatId, stockText());
  if (cmd === 'ayuda' || cmd === 'help' || cmd === 'start') return reply(chatId, HELP);
  const action = COMMAND_ACTIONS[cmd];
  if (action) {
    const id = /^#?\d+$/.test(args[0] || '') ? Number(args[0].replace('#', '')) : null;
    if (!id || !Number.isSafeInteger(id)) return reply(chatId, `Uso: /${cmd} <id>  (ej. /${cmd} 12)`);
    if (!getOrderRow(id)) return reply(chatId, `⚠️ El pedido #${id} no existe.`);
    const r = runAction(action, id);
    return reply(chatId, r.text, r.markup);
  }
  return reply(chatId, `No conozco /${cmd}.\n\n${HELP}`);
}

/**
 * Handles a button press.
 * @param {object} cq - callback_query.
 */
async function handleCallback(cq) {
  const data = String(cq.data || '');
  const draft = data.match(/^d:([0-9a-f]{12}):(ok|no)$/);
  if (draft) return handleDraftCallback(cq, draft[1], draft[2]);

  const m = data.match(/^([cxpue]):(\d{1,12})(:f)?$/);
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
    else await handleNotes(msg.chat.id, msg.text);
    return 'handled';
  } catch (err) {
    console.error('[telegram] update falló:', err);
    return 'handled';
  }
}

/** Test helper: clears in-memory drafts and seen updates. */
function _reset() {
  drafts.clear();
  seenUpdates.clear();
}

module.exports = { handleUpdate, isAllowed, allowedChats, listActive, _reset, _drafts: drafts };
