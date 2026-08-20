const crypto = require('crypto');
const { env } = require('../config/env');

// Hash both sides before comparing so timingSafeEqual always gets equal-length
// inputs (it throws on length mismatch, and a plain length check would leak
// the token length through timing).
function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

const expectedDigest = sha256(env.APP_TOKEN);

/**
 * Shared static bearer token auth. Expects `Authorization: Bearer <APP_TOKEN>`.
 * Mounted on /api AFTER the health route, so GET /api/health stays open.
 */
function auth(req, res, next) {
  const header = req.headers.authorization;

  let token = null;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length);
  }

  if (!token || !crypto.timingSafeEqual(sha256(token), expectedDigest)) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' },
    });
  }

  next();
}

module.exports = { auth };
