/**
 * PLAN-11 (ADR-4): única definición de "pedido vivo" y del estado de revisión.
 *
 * Un pedido web nace "por confirmar" con una reserva provisional de stock que
 * vence sola en `expires_at`. El vencimiento NO depende de un cron: se evalúa
 * en cada consulta con este fragmento SQL, así que el stock se libera en el
 * mismo instante en que pasa el plazo, aunque el barrido de avisos no corra.
 *
 * Este fragmento debe vivir SOLO acá: si cada controlador escribiera su propia
 * versión, el stock, el kardex y los reportes terminarían discrepando.
 */

// PLAN-11: sin alias de tabla → usar solo en consultas de una tabla (FROM orders).
// STOCK FASE 2: un pedido borrado (soft delete, deleted_at) nunca está vivo.
const LIVE_ORDER_SQL = "deleted_at IS NULL AND status != 'cancelado' AND (confirmed_at IS NOT NULL OR expires_at > datetime('now'))";
// PLAN-11: variante con alias `o.` para consultas con JOIN.
const LIVE_ORDER_SQL_O = "o.deleted_at IS NULL AND o.status != 'cancelado' AND (o.confirmed_at IS NOT NULL OR o.expires_at > datetime('now'))";

// PLAN-11: contadores de revisión para reportes. Viven acá junto a
// LIVE_ORDER_SQL para que ninguna consulta repita el filtro de 'cancelado'.
const PENDING_REVIEW_SQL = "deleted_at IS NULL AND status != 'cancelado' AND confirmed_at IS NULL AND expires_at > datetime('now')";
const EXPIRED_REVIEW_SQL = "deleted_at IS NULL AND status != 'cancelado' AND confirmed_at IS NULL AND expires_at <= datetime('now')";

// STOCK FASE 2: el ledger de stock_movements guarda también los asientos de
// los pedidos ('venta' reserva, 'reverso' libera), pero esos asientos son la
// HISTORIA fechada, no la fuente del número: el vencimiento de una reserva web
// no tiene quién lo escriba en el instante en que ocurre (LIVE_ORDER_SQL lo
// evalúa en cada consulta), así que si sumaran al stock, el número se movería
// recién cuando alguien materializa el vencimiento. El stock sigue siendo
//   Σ movimientos CONTADOS − Σ ventas vivas
// y 'merma' cuenta porque es hallaca perdida de verdad (A3), no una reserva.
const COUNTED_MOVEMENT_SQL = "kind IN ('ajuste','tanda','merma')";
// Asientos sombra de los pedidos: su suma por pedido = −reserva actual.
const ORDER_LEDGER_SQL = "kind IN ('venta','reverso')";

// Valores ya avisados: el warning se emite una sola vez por variable, no en
// cada consulta (estas funciones se llaman por request).
const warned = new Set();

/**
 * Reads an integer environment variable within [min, max].
 * Falls back to `fallback` (with a one-time console.warn) when the value is
 * missing, non-integer or out of range.
 * @param {string} name - Environment variable name.
 * @param {number} fallback - Default value.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {number}
 */
function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  const key = `${name}=${raw}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`⚠ ${name}=${raw} inválido (entero ${min}..${max}); se usa ${fallback}.`);
  }
  return fallback;
}

/**
 * Provisional hold duration for web orders, in hours (ORDER_HOLD_HOURS).
 * @returns {number} Integer in 1..168, default 24.
 */
function holdHours() {
  return intEnv('ORDER_HOLD_HOURS', 24, 1, 168);
}

/**
 * Hours before expiry when the "expiring soon" notice is sent
 * (ORDER_REMINDER_HOURS_BEFORE).
 * @returns {number} Integer in 0..holdHours()-1, default min(4, holdHours()-1).
 */
function reminderHours() {
  const hold = holdHours();
  // PLAN-11: con ORDER_HOLD_HOURS=1 el default 4 quedaría fuera de rango; se
  // recorta para que el aviso siempre caiga dentro de la reserva (ADR-4, D5).
  return intEnv('ORDER_REMINDER_HOURS_BEFORE', Math.min(4, hold - 1), 0, hold - 1);
}

/**
 * Max live, undelivered web hallacas per phone/user (MAX_HALLACAS_POR_TELEFONO).
 * @returns {number} Integer in 1..10000, default 20.
 */
function maxPorTelefono() {
  return intEnv('MAX_HALLACAS_POR_TELEFONO', 20, 1, 10000);
}

/**
 * Parses a SQLite `datetime('now')` string (UTC, "YYYY-MM-DD HH:MM:SS") as UTC.
 * @param {string|null} value
 * @returns {Date|null}
 */
function parseUtc(value) {
  if (!value) return null;
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derived review state of an order (ADR-4, D2). Never stored.
 * @param {{confirmed_at?: string|null, expires_at?: string|null}} row
 * @param {Date} [now] - Reference instant (defaults to current time).
 * @returns {'confirmado'|'por_confirmar'|'vencido'}
 */
function reviewState(row, now = new Date()) {
  if (row.confirmed_at) return 'confirmado';
  const expires = parseUtc(row.expires_at);
  // PLAN-11: sin confirmed_at ni expires_at no debería existir tras el
  // backfill; si apareciera, se trata como vencido (no reserva stock), igual
  // que LIVE_ORDER_SQL, donde `NULL > datetime('now')` es falso.
  if (!expires) return 'vencido';
  return expires > now ? 'por_confirmar' : 'vencido';
}

module.exports = {
  LIVE_ORDER_SQL,
  LIVE_ORDER_SQL_O,
  PENDING_REVIEW_SQL,
  EXPIRED_REVIEW_SQL,
  COUNTED_MOVEMENT_SQL,
  ORDER_LEDGER_SQL,
  holdHours,
  reminderHours,
  maxPorTelefono,
  reviewState,
  parseUtc,
};
