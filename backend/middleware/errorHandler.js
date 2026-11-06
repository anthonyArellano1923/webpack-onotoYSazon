/**
 * PLAN-13: central Express error handler.
 *
 * Client mistakes (malformed JSON, oversized body, disallowed CORS origin) are
 * answered with their proper 4xx and a Spanish `{ error }` body, WITHOUT
 * logging a stack trace: they are noise, not server faults. Only genuinely
 * unexpected errors reach the 500 branch and are logged.
 */

/**
 * Builds the error raised by the CORS origin check.
 * @param {string} origin - The rejected Origin header.
 * @returns {Error} Error tagged with `code = 'CORS_NOT_ALLOWED'`.
 */
function corsError(origin) {
  const err = new Error(`Origen no permitido por CORS: ${origin}`);
  err.code = 'CORS_NOT_ALLOWED';
  return err;
}

/**
 * Maps a known client error to its HTTP status and message.
 * @param {Error & {type?: string, code?: string}} err
 * @returns {{status: number, error: string}|null} Null when the error is not a known client error.
 */
function classifyClientError(err) {
  if (!err) return null;
  if (err.type === 'entity.parse.failed') {
    return { status: 400, error: 'El cuerpo de la petición no es un JSON válido.' };
  }
  if (err.type === 'entity.too.large') {
    return { status: 413, error: 'El cuerpo de la petición es demasiado grande.' };
  }
  // Otros errores de body-parser (415 charset/encoding, 400 aborted...): llevan
  // `type` y un status 4xx propio; son del cliente, no fallas del servidor.
  if (typeof err.type === 'string' && err.status >= 400 && err.status < 500) {
    return { status: err.status, error: 'Petición inválida.' };
  }
  if (err.code === 'CORS_NOT_ALLOWED') {
    return { status: 403, error: 'Origen no permitido.' };
  }
  return null;
}

/**
 * Express error-handling middleware (4 args are required for Express to treat
 * it as an error handler).
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Si ya se envió parte de la respuesta, solo Express puede cerrar la conexión.
  if (res.headersSent) return next(err);

  const client = classifyClientError(err);
  if (client) return res.status(client.status).json({ error: client.error });

  console.error('Error no manejado:', err);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = { errorHandler, corsError, classifyClientError };
