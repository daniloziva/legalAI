const express = require('express');
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

app.use(errorHandler);

module.exports = app;
