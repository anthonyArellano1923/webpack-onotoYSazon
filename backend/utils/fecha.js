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

module.exports = { esFechaValida, hoyLocal, FORMATO_FECHA: FORMATO };
