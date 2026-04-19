require('dotenv').config();

const app = require('./app');
const { env } = require('./config/env');
const { logger } = require('./middleware/requestLogger');

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'LegalAI server started');
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received, closing server');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if connections are still open
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
