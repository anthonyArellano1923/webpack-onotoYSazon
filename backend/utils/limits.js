/**
 * PLAN-13: shared numeric limits and strict type guards for request bodies.
 * Number.isInteger(1e300) is true, so an integer check alone lets absurd
 * amounts through and breaks the reports; every CLP amount is capped here.
 */

/** Upper bound for any CLP amount (total, price, cost): 100.000.000. */
const MAX_MONTO_CLP = 100000000;

/**
 * True when `value` is a valid CLP amount: a safe integer in [0, MAX_MONTO_CLP].
 * @param {unknown} value
 * @returns {boolean}
 */
function isMontoClp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONTO_CLP;
}

/** Message shared by every amount rejection. */
const MONTO_RANGE_MSG = `entero entre 0 y ${MAX_MONTO_CLP.toLocaleString('es-CL')}`;

module.exports = { MAX_MONTO_CLP, MONTO_RANGE_MSG, isMontoClp };
