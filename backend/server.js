require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { apiLimiter } = require('./middleware/rateLimiter');
const { createAdminIfNeeded } = require('./database/db');

const authRoutes  = require('./routes/auth.routes');
const orderRoutes = require('./routes/orders.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// Seguridad: headers HTTP seguros
app.use(helmet());

// CORS: solo permite el origen del frontend
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3006',
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

// Limita tamaño del body para prevenir ataques de payload
app.use(express.json({ limit: '10kb' }));

// Rate limiting general a toda la API
app.use('/api', apiLimiter);

// Rutas
app.use('/api/auth',   authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin',  adminRoutes);

// Health check — Render.com lo usa para saber si el servicio está vivo
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Error global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

createAdminIfNeeded();

app.listen(PORT, () => {
  console.log(`✓ Backend corriendo en http://localhost:${PORT}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
