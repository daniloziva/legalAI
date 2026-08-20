const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { env } = require('./config/env');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');
const healthRoutes = require('./routes/health.routes');
const extractRoutes = require('./routes/extract.routes');
const exportRoutes = require('./routes/export.routes');

const app = express();

// Railway terminates TLS at a single proxy hop — trust it so req.ip (and the
// rate limiter keys) reflect the real client IP.
app.set('trust proxy', 1);

// Security headers. CSP must keep the SPA working: the PDF preview renders in
// a blob: iframe, and the Vite build may inject inline <style> tags.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'frame-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
    },
  },
}));

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

// Batch-poll GETs are exempt from the general limit (lead decision): they are
// authenticated, a cheap in-memory Map lookup, and a large batch polls every
// 2s — enough to eat the whole budget. NOTE: mounted under /api, so req.path
// here has the /api prefix already stripped.
const POLL_PATH_RE = /^\/extract\/[0-9a-f-]{36}$/;

// General API rate limit: 300 requests / 15 min per IP.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' && POLL_PATH_RE.test(req.path),
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Previše zahteva, pokušajte ponovo kasnije' },
    });
  },
});

// Upload rate limit: 60 batch submissions / hour per IP (POST only). The whole
// office shares one NAT IP and one token, so this is effectively a global cap
// on worst-case Azure spend rather than a per-user limit.
const extractLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Dostignut je limit otpremanja, pokušajte ponovo kasnije' },
    });
  },
});

// Health stays open (no auth, no rate limit) so platform healthchecks work.
app.use('/api', healthRoutes);

app.use('/api', apiLimiter);
app.use('/api', auth);
app.use('/api/extract', (req, res, next) => {
  if (req.method !== 'POST') return next();
  return extractLimiter(req, res, next);
});
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
