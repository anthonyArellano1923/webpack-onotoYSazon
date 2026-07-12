const { Router } = require('express');
const { body } = require('express-validator');
const { register, login } = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiter');
const { handleValidationErrors } = require('../middleware/validate');
const { normalizePhone } = require('../utils/phone');

const router = Router();

// Rate limiter estricto en todas las rutas de auth
router.use(authLimiter);

// El identificador de cuenta es el TELÉFONO (decisión del dueño: sus clientes
// se manejan por WhatsApp, no por correo). El email quedó opcional.
const registerValidators = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre es requerido.')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres.'),
  body('phone')
    .custom((value) => normalizePhone(value) !== null)
    .withMessage('Teléfono inválido. Debe ser un celular chileno de 9 dígitos (9XXXXXXXX).'),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/[A-Z]/).withMessage('La contraseña debe tener al menos una letra mayúscula.')
    .matches(/[0-9]/).withMessage('La contraseña debe tener al menos un número.'),
  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail().withMessage('Correo electrónico inválido.')
    .normalizeEmail(),
  body('address')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 }).withMessage('La dirección es muy larga.'),
];

const loginValidators = [
  body('phone')
    .custom((value) => normalizePhone(value) !== null)
    .withMessage('Teléfono inválido.'),
  body('password').notEmpty().withMessage('Contraseña requerida.'),
];

router.post('/register', registerValidators, handleValidationErrors, register);
router.post('/login',    loginValidators,    handleValidationErrors, login);

module.exports = router;
