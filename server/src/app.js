const express = require('express');
const path = require('path');
const cors = require('cors');
const { env } = require('./config/env');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health.routes');
const extractRoutes = require('./routes/extract.routes');
const exportRoutes = require('./routes/export.routes');

const app = express();

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

app.use('/api', healthRoutes);
app.use('/api', extractRoutes);
app.use('/api', exportRoutes);

// Serve React frontend in production
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 404 handler (API only)
app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found' },
  });
});

app.use(errorHandler);

module.exports = app;
