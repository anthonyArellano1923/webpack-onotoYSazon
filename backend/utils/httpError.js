/**
 * PLAN-11: errores de negocio con status HTTP y código estable para el frontend.
 *
 * Se clasifica por `statusCode`, NO por `code`: los errores de better-sqlite3
 * también traen `.code` (SQLITE_CONSTRAINT, ...) y no deben filtrarse al
 * cliente como si fueran códigos de negocio.
 */

/** Mensaje exacto de D9: el frontend lo muestra tal cual junto al botón de WhatsApp. */
const CONTACT_SELLER_MSG = 'Para un pedido así, ponte en contacto directo con el vendedor.';

/**
 * Builds a business error carrying an HTTP status and optional code/extra fields.
 * @param {number} statusCode - HTTP status to respond with.
 * @param {string} message - Human-readable message (sent as `error`).
 * @param {string} [code] - Stable machine code (e.g. 'SIN_STOCK').
 * @param {object} [extra] - Additional JSON fields (e.g. { stock, requerido }).
 * @returns {Error}
 */
function httpError(statusCode, message, code, extra) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.businessCode = code;
  if (extra) err.extra = extra;
  return err;
}

/**
 * Sends the right response for an error thrown inside a controller.
 * - Business errors (with statusCode) → { error, code?, ...extra }.
 * - SQLITE_BUSY* → 503 (another write holds the lock; the client may retry).
 * - Anything else → 500 with `fallbackMessage`, never exposing SQLite codes.
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} fallbackMessage - Message for unexpected errors.
 * @param {string} logLabel - Prefix for console.error.
 */
function sendError(res, err, fallbackMessage, logLabel) {
  if (err && err.statusCode) {
    const body = { error: err.message };
    if (err.businessCode) body.code = err.businessCode;
    if (err.extra) Object.assign(body, err.extra);
    return res.status(err.statusCode).json(body);
  }
  // PLAN-11 (M5): con transacciones .immediate() una escritura concurrente
  // puede recibir SQLITE_BUSY; es transitorio, así que 503 y no 500.
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY')) {
    return res.status(503).json({ error: 'Servidor ocupado, intenta de nuevo.' });
  }
  console.error(`${logLabel}:`, err);
  return res.status(500).json({ error: fallbackMessage });
}

/**
 * Parses a route id param as a positive integer.
 * @param {unknown} value
 * @returns {number|null} The id, or null when invalid.
 */
function parsePositiveId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^\d+$/.test(String(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

module.exports = { CONTACT_SELLER_MSG, httpError, sendError, parsePositiveId };
