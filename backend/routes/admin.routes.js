const { Router } = require('express');
const { body } = require('express-validator');
const { getAllOrders, updateOrderStatus } = require('../controllers/admin.controller');
const { requireAuth } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { handleValidationErrors } = require('../middleware/validate');

const router = Router();

// Todas las rutas admin requieren JWT válido + rol admin
router.use(requireAuth, adminOnly);

router.get('/orders', getAllOrders);

router.patch(
  '/orders/:id/status',
  [body('status').notEmpty().withMessage('El estado es requerido.')],
  handleValidationErrors,
  updateOrderStatus
);

module.exports = router;
