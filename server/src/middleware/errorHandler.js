const { logger } = require('./requestLogger');

function errorHandler(err, req, res, _next) {
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the 20MB size limit' },
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      error: { code: 'TOO_MANY_FILES', message: 'Maximum 20 files per upload' },
    });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: { code: 'UNEXPECTED_FIELD', message: err.message },
    });
  }
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: { code: 'INVALID_FILE_TYPE', message: err.message },
    });
  }

  const statusCode = err.statusCode || 500;
  const code = err.errorCode || 'INTERNAL_ERROR';
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  logger.error({ err, method: req.method, url: req.url }, message);

  const response = { error: { code, message } };

  if (process.env.NODE_ENV === 'development' && statusCode === 500) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = { errorHandler };
