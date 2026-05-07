const { Router } = require('express');
const { body } = require('express-validator');
const { createOrder, getMyOrders } = require('../controllers/orders.controller');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validate');

const router = Router();

const orderValidators = [
  body('items')
    .isArray({ min: 1 }).withMessage('Debes incluir al menos un producto.'),
  body('items.*.packId')
    .notEmpty().withMessage('ID de pack requerido.'),
  body('items.*.packName')
    .notEmpty().withMessage('Nombre de pack requerido.')
    .trim()
    .isLength({ max: 100 }),
  body('items.*.qty')
    .isInt({ min: 1, max: 100 }).withMessage('Cantidad debe ser entre 1 y 100.'),
  body('delivery')
    .optional()
    .isIn(['retiro', 'despacho']).withMessage('Modalidad inválida.'),
  body('notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 }).withMessage('Las notas no pueden superar 500 caracteres.')
    .escape(),
  body('dateHint')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 50 }),
];

router.post('/',     requireAuth, orderValidators, handleValidationErrors, createOrder);
router.get('/mine',  requireAuth, getMyOrders);

module.exports = router;
