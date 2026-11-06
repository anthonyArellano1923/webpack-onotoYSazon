/**
 * Allows the request only when the user's CURRENT role is admin.
 * PLAN-13: `req.user.role` is set by requireAuth from the database (not from
 * the JWT), so revoking someone's role takes effect on their next request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  next();
}

module.exports = { adminOnly };
