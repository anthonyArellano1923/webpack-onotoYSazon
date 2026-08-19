const { Router } = require('express');
const {
  getAllOrders, createManualSale, updateOrder, deleteOrder,
  getAllUsers, deleteUser, getPacks, updatePack,
  getSettings, updateSettings, getReports,
} = require('../controllers/admin.controller');
const {
  getAllBatches, createBatch, updateBatch, deleteBatch,
} = require('../controllers/batches.controller');
const {
  getKardex, createMovement, deleteMovement,
} = require('../controllers/stock.controller');
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
// QA-12: borrado físico de ventas (errores/pruebas); 'cancelado' sigue
// existiendo para pedidos reales que no se concretan (historial).
router.delete('/orders/:id', deleteOrder);

// Usuarios
router.get('/users', getAllUsers);
// QA-12 (ampliado): borrado físico de usuarios; bloquea cuentas admin (403).
router.delete('/users/:id', deleteUser);

// Packs y precios
router.get('/packs', getPacks);
router.patch('/packs/:id', updatePack);

// Stock (ADR-3, plan 09): el stock es un dato propio en stock_movements, y
// estas rutas son su única puerta de escritura. Las ventas no se escriben acá
// (se derivan de orders) y las tandas no se consultan (invariante I-1).
router.get('/stock/kardex', getKardex);
router.post('/stock/movements', createMovement);
router.delete('/stock/movements/:id', deleteMovement);

// Tandas de producción (QA-16): registro de COSTOS — inversión, costo por
// hallaca, ganancia, margen. ADR-3: NO calculan el stock. Crear una tanda
// ingresa su cantidad al stock como movimiento independiente; borrarla o
// editarla NO lo mueve.
router.get('/batches', getAllBatches);
router.post('/batches', createBatch);
router.patch('/batches/:id', updateBatch);
router.delete('/batches/:id', deleteBatch);

// Parámetros del negocio (solo precio por hallaca; el costo viene de tandas y
// el stock de stock_movements)
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);

// Reportes (réplica de la "Organización de ingresos" del Excel)
router.get('/reports', getReports);

module.exports = router;
