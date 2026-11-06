/**
 * Validación de fechas de negocio (`YYYY-MM-DD`, hora local de Chile).
 *
 * H-3 (auditoría 10): `occurred_at` de los movimientos de stock y `produced_at`
 * de las tandas se guardaban sin validar, así que `"basura"`, `"2026-13-45"` o
 * un número entraban con 201 y quedaban en la BD. El total seguía bien (es un
 * SUM) pero el kardex se volvía ilegible: las filas se ordenan por esta fecha,
 * y una fecha basura descoloca el saldo corrido.
 *
 * Se valida el formato Y que la fecha exista de verdad (el round-trip descarta
 * cosas como 2026-02-31, que `Date` acepta y corre al 3 de marzo).
 */
const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

function esFechaValida(valor) {
  if (typeof valor !== 'string' || !FORMATO.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === valor;
}

/** Fecha de hoy en hora local, en el mismo formato que guarda SQLite. */
function hoyLocal() {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * STOCK FASE 2: true when a valid `YYYY-MM-DD` date is after today (local).
 * Una venta o un movimiento con fecha futura descoloca el kardex (el saldo de
 * hoy incluiría algo que no pasó), así que se rechazan con 400.
 * @param {string} valor - Already validated with esFechaValida.
 * @returns {boolean}
 */
function esFechaFutura(valor) {
  return valor > hoyLocal();
}

const FECHA_FUTURA_MSG = 'La fecha no puede ser futura.';

module.exports = {
  esFechaValida, esFechaFutura, hoyLocal, FORMATO_FECHA: FORMATO, FECHA_FUTURA_MSG,
};
