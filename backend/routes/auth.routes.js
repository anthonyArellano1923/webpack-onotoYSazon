const { Router } = require('express');
const { body } = require('express-validator');
const { register, login } = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiter');
const { handleValidationErrors } = require('../middleware/validate');

const router = Router();

// Rate limiter estricto en todas las rutas de auth
router.use(authLimiter);

const registerValidators = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre es requerido.')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres.'),
  body('email')
    .trim()
    .isEmail().withMessage('Correo electrónico inválido.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/[A-Z]/).withMessage('La contraseña debe tener al menos una letra mayúscula.')
    .matches(/[0-9]/).withMessage('La contraseña debe tener al menos un número.'),
  body('phone')
    .optional({ checkFalsy: true })
    .matches(/^\+?[\d\s\-()\\.]{7,20}$/).withMessage('Número de teléfono inválido.'),
];

const loginValidators = [
  body('email').trim().isEmail().withMessage('Correo inválido.').normalizeEmail(),
  body('password').notEmpty().withMessage('Contraseña requerida.'),
];

router.post('/register', registerValidators, handleValidationErrors, register);
router.post('/login',    loginValidators,    handleValidationErrors, login);

module.exports = router;
