const { Router } = require('express');
const {
  getAllOrders, createManualSale, updateOrder,
  getAllUsers, getPacks, updatePack,
  getSettings, updateSettings, getReports,
} = require('../controllers/admin.controller');
const { requireAuth } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

const router = Router();

// Todas las rutas admin requieren JWT válido + rol admin.
// La validación de campos vive en los controladores (updates parciales:
// express-validator complica el "solo valida lo que venga").
router.use(requireAuth, adminOnly);

// Ventas (el "registro de ventas" del Excel)
router.get('/orders', getAllOrders);
router.post('/orders', createManualSale);
router.patch('/orders/:id', updateOrder);

// Usuarios
router.get('/users', getAllUsers);

// Packs y precios
router.get('/packs', getPacks);
router.patch('/packs/:id', updatePack);

// Parámetros del negocio (precio/costo por hallaca, hallacas producidas)
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

// Reportes (réplica de la "Organización de ingresos" del Excel)
router.get('/reports', getReports);

module.exports = router;
