/**
 * PLAN-12 (ADR-5): parser del formato de Notas del dueño.
 *
 *   Tanda prueba:
 *     Elías: 4. Por entregar. Pagado.
 *     Bryan Toloza: 2. Pendiente pago. Por entregar.
 *     #12 Leonel Landaeta: 3. Pendiente de pago.
 *
 * Reglas (el parser NO adivina: lo que no reconoce lo devuelve como error):
 * - `Nombre: cantidad. estado. estado.` Los estados van en cualquier orden,
 *   separados por punto, coma o punto y coma.
 * - Mayúsculas y tildes dan igual ("Pagada" = "pagado", "Cortesía" = "cortesia").
 * - `#ID` al inicio opera sobre un pedido existente (con nombres repetidos es
 *   la única forma inequívoca). El bot compara nombre/cantidad con la BD.
 * - Una línea `Algo:` sin nada después es un encabezado ("Tanda prueba:") y se
 *   ignora, pero se muestra en el resumen para que el dueño lo vea.
 * - Teléfono opcional (9 dígitos chilenos). Sin teléfono, el pedido queda sin él.
 *
 * Solo interpreta texto: no toca la BD.
 */
const { normalizePhone } = require('../utils/phone');

// Mismo tope que una venta manual (R-5 / H-7).
const MAX_QTY = 10000;
const MAX_NAME = 100;

/**
 * Lowercases, strips diacritics and collapses whitespace.
 * @param {string} s
 * @returns {string}
 */
function fold(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classifies one status token (already folded). El orden importa: "pendiente
 * pago" contiene "pago", así que pendiente se evalúa antes, y "por entregar"
 * antes que entregad[oa].
 * @param {string} t - Folded token.
 * @returns {{field: string, value: any}|null} null when the token is unknown.
 */
function classifyToken(t) {
  if (/^pendiente( de)?( pago)?$/.test(t) || t === 'por pagar' || t === 'no pagado' || t === 'no pagada') {
    return { field: 'pay', value: 'pendiente_pago' };
  }
  if (/^pagad[oa]$/.test(t)) return { field: 'pay', value: 'pagado' };
  if (t === 'cortesia') return { field: 'pay', value: 'cortesia' };
  if (t === 'por entregar' || t === 'sin entregar' || /^no entregad[oa]$/.test(t)) {
    return { field: 'delivered', value: false };
  }
  if (/^entregad[oa]$/.test(t)) return { field: 'delivered', value: true };
  if (t === 'encargo') return { field: 'encargo', value: true };
  // Teléfono antes que cantidad: 912345678 también es un entero.
  const phone = /^[+\d][\d\s-]{7,}$/.test(t) ? normalizePhone(t) : null;
  if (phone) return { field: 'phone', value: phone };
  const qty = t.match(/^(\d+)( hallacas?)?$/);
  if (qty) return { field: 'qty', value: Number(qty[1]) };
  return null;
}

/**
 * Parses one line of the Notes format.
 * @param {string} raw - Original line.
 * @returns {{kind: 'blank'}|{kind: 'header', name: string}|{kind: 'error', reason: string}
 *   |{kind: 'order', id: number|null, name: string|null, qty: number|null,
 *     pay: string|null, delivered: boolean|null, encargo: boolean, phone: string|null}}
 */
function parseLine(raw) {
  // Viñetas comunes de Notas ("-", "•", "*") no son parte del nombre.
  let line = String(raw).replace(/^\s*[-•*·]\s*/, '').trim();
  if (!line) return { kind: 'blank' };

  let id = null;
  const idMatch = line.match(/^#(\d+)\b\s*/);
  if (idMatch) {
    id = Number(idMatch[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return { kind: 'error', reason: 'ID inválido' };
    line = line.slice(idMatch[0].length);
  }

  let name = null;
  let rest = line;
  const colon = line.indexOf(':');
  if (colon >= 0) {
    name = line.slice(0, colon).trim() || null;
    rest = line.slice(colon + 1);
  } else if (id === null) {
    return { kind: 'error', reason: 'falta «Nombre: cantidad»' };
  }

  const tokens = rest.split(/[.,;]/).map(fold).filter(Boolean);
  if (tokens.length === 0) {
    // Encabezado ("Tanda prueba:"). Con #ID no hay encabezado posible.
    if (id === null && name) return { kind: 'header', name };
    return { kind: 'error', reason: 'no indica nada que cambiar' };
  }
  if (name && name.length > MAX_NAME) return { kind: 'error', reason: 'nombre demasiado largo' };

  const out = { kind: 'order', id, name, qty: null, pay: null, delivered: null, encargo: false, phone: null };
  const seen = new Set();
  for (const t of tokens) {
    const c = classifyToken(t);
    if (!c) return { kind: 'error', reason: `no entiendo «${t}»` };
    // Repetir el mismo dato es inofensivo; contradecirse ("pagado. pendiente") no.
    if (seen.has(c.field) && out[c.field] !== c.value) {
      return { kind: 'error', reason: `datos contradictorios («${t}»)` };
    }
    seen.add(c.field);
    out[c.field] = c.value;
  }

  if (out.qty !== null && (out.qty < 1 || out.qty > MAX_QTY)) {
    return { kind: 'error', reason: `cantidad fuera de rango (1 a ${MAX_QTY})` };
  }
  if (id === null) {
    if (!name) return { kind: 'error', reason: 'falta el nombre' };
    if (out.qty === null) return { kind: 'error', reason: 'falta la cantidad de hallacas' };
  }
  // Un encargo no reserva stock: el backend exige concretarlo antes de
  // entregarlo, así que registrarlo "entregado" dejaría media venta.
  if (out.encargo && out.delivered === true) {
    return { kind: 'error', reason: 'un encargo no puede registrarse entregado' };
  }
  return out;
}

/**
 * Parses a whole message (one or many lines).
 * @param {string} text
 * @returns {Array<{n: number, raw: string} & ReturnType<typeof parseLine>>}
 *   One entry per non-blank line, `n` is the 1-based line number.
 */
function parseMessage(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((raw, i) => ({ n: i + 1, raw: raw.trim(), ...parseLine(raw) }))
    .filter((l) => l.kind !== 'blank');
}

const PAY_LABEL = { pagado: 'Pagado', pendiente_pago: 'Pendiente de pago', cortesia: 'Cortesía' };

/**
 * Formats an order row in the owner's Notes format, prefixed by `#ID`.
 * La salida vuelve a parsearse con parseLine (ida y vuelta): así el dueño
 * puede copiar una línea de /pedidos, cambiar el estado y reenviarla.
 * @param {{id: number, customer_name: string, quantity_hallacas: number,
 *   status: string, delivered_at: string|null, stock_exempt: number}} o
 * @returns {string}
 */
function formatOrderLine(o) {
  const parts = [`#${o.id} ${o.customer_name}: ${o.quantity_hallacas}`];
  if (o.stock_exempt === 1) parts.push('Encargo');
  parts.push(PAY_LABEL[o.status] || o.status);
  parts.push(o.delivered_at ? 'Entregado' : 'Por entregar');
  return `${parts.join('. ')}.`;
}

module.exports = { fold, parseLine, parseMessage, formatOrderLine, PAY_LABEL };
