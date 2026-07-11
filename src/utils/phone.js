/**
 * @fileoverview Normalización de teléfonos móviles chilenos a formato E.164.
 *
 * El usuario siempre escribe los 9 dígitos locales (`9XXXXXXXX`); el
 * prefijo `+56` se agrega al guardar o mostrar, nunca se le pide al usuario.
 *
 * @module utils/phone
 */

const CL_MOBILE_RE = /^9\d{8}$/;

/**
 * Deja solo dígitos y quita el prefijo 56 si el usuario lo escribió a mano.
 * @param {string} raw
 * @returns {string} p.ej. '912345678'
 */
export function phoneToDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('56') && digits.length > 9) digits = digits.slice(2);
  return digits;
}

/**
 * Valida y normaliza a E.164 chileno (+56XXXXXXXXX).
 * @param {string} raw
 * @returns {string|null} p.ej. '+56912345678', o null si no son 9 dígitos válidos.
 */
export function normalizePhone(raw) {
  const digits = phoneToDigits(raw);
  if (!CL_MOBILE_RE.test(digits)) return null;
  return `+56${digits}`;
}

/**
 * Formato sin '+' para enlaces wa.me.
 * @param {string} raw
 * @returns {string|null} p.ej. '56912345678'
 */
export function phoneToWa(raw) {
  const normalized = normalizePhone(raw);
  return normalized ? normalized.slice(1) : null;
}
