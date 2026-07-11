/**
 * Normalización de teléfonos móviles chilenos a formato E.164.
 * Espejo de src/utils/phone.js (frontend) — mismo contrato, sintaxis CommonJS.
 */

const CL_MOBILE_RE = /^9\d{8}$/;

function phoneToDigits(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('56') && digits.length > 9) digits = digits.slice(2);
  return digits;
}

function normalizePhone(raw) {
  const digits = phoneToDigits(raw);
  if (!CL_MOBILE_RE.test(digits)) return null;
  return `+56${digits}`;
}

function phoneToWa(raw) {
  const normalized = normalizePhone(raw);
  return normalized ? normalized.slice(1) : null;
}

module.exports = { normalizePhone, phoneToDigits, phoneToWa };
