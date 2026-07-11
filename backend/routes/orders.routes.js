const { Router } = require('express');
const { body } = require('express-validator');
const { createOrder, getMyOrders } = require('../controllers/orders.controller');
const { requireAuth } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');
const { handleValidationErrors } = require('../middleware/validate');
const { normalizePhone } = require('../utils/phone');

const router = Router();

const orderValidators = [
  body('name')
    .trim().notEmpty().withMessage('Nombre requerido.')
    .isLength({ max: 100 }).withMessage('El nombre es muy largo.'),
  body('phone')
    .custom((value) => normalizePhone(value) !== null)
    .withMessage('Teléfono inválido. Debe ser un número chileno de 9 dígitos (9XXXXXXXX).'),
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
  body('address')
    .if((value, { req }) => req.body.delivery === 'despacho')
    .trim().notEmpty().withMessage('La dirección (calle, número y comuna) es requerida para despacho.')
    .isLength({ max: 200 }).withMessage('La dirección es muy larga.')
    .escape(),
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

router.post('/',     optionalAuth, orderValidators, handleValidationErrors, createOrder);
router.get('/mine',  requireAuth, getMyOrders);

module.exports = router;
