const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { ocr } = require('../services/ocr');
const { extract } = require('../services/extraction');
const { logger } = require('../middleware/requestLogger');

const router = Router();

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const jobs = new Map();

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB per file
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = file.originalname.toLowerCase().endsWith('.pdf');

    if (!isPdfMime || !isPdfExt) {
      const err = new Error('Only PDF files are accepted');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }

    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// POST /api/extract — submit a batch of PDFs
// ---------------------------------------------------------------------------

router.post('/extract', upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      error: { code: 'NO_FILES', message: 'At least one PDF file is required' },
    });
  }

  const batchId = crypto.randomUUID();
  const job = {
    files: req.files,
    fileCount: req.files.length,
    results: [],
    status: 'processing',
    cleanupTimer: null,
  };

  jobs.set(batchId, job);

  // Return 202 immediately
  res.status(202).json({
    batchId,
    fileCount: req.files.length,
    status: 'processing',
  });

  // Process files sequentially in background
  processFiles(batchId, job).catch((err) => {
    logger.error({ err, batchId }, 'Batch processing crashed unexpectedly');
    job.status = 'complete';
  });
});

// ---------------------------------------------------------------------------
// GET /api/extract/:batchId — poll for progress
// ---------------------------------------------------------------------------

router.get('/extract/:batchId', (req, res) => {
  const job = jobs.get(req.params.batchId);

  if (!job) {
    return res.status(404).json({
      error: { code: 'BATCH_NOT_FOUND', message: 'Batch not found or expired' },
    });
  }

  res.json({
    batchId: req.params.batchId,
    status: job.status,
    total: job.fileCount,
    completed: job.results.length,
    results: job.results,
  });
});

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------

async function processFiles(batchId, job) {
  for (const file of job.files) {
    try {
      // Step 1: OCR
      const ocrText = await ocr(file.buffer);

      // Step 2: Extraction
      const { fields, tokenUsage } = await extract(ocrText);

      // Step 3: Default pdvPercent to 20 if LLM didn't find an explicit value
      if (!fields.pdvPercent.value) {
        fields.pdvPercent.value = '20';
        fields.pdvPercent.confidence = 'low';
      }

      job.results.push({
        filename: file.originalname,
        fields,
        tokenUsage,
      });
    } catch (err) {
      logger.error({ err, filename: file.originalname, batchId }, 'File processing failed');
      job.results.push({
        filename: file.originalname,
        error: err.message,
      });
    }
  }

  // Release PDF buffers from memory now that processing is done
  job.files = null;

  job.status = 'complete';
  logger.info({ batchId, total: job.fileCount, completed: job.results.length }, 'Batch processing complete');

  // Start TTL cleanup AFTER processing completes (not at submission time)
  job.cleanupTimer = setTimeout(() => {
    jobs.delete(batchId);
  }, JOB_TTL_MS);
  job.cleanupTimer.unref();
}

module.exports = router;
