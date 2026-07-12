const { Router } = require('express');
const { listPublicPacks } = require('../controllers/packs.controller');

const router = Router();

// Público: el menú de la web lee el catálogo (precios y disponibilidad
// editables desde el admin) en vez del packs.js estático.
router.get('/', listPublicPacks);

module.exports = router;
