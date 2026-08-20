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

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes after completion
const JOB_MAX_AGE_MS = 60 * 60 * 1000; // hard safety expiry from submission
const MAX_ACTIVE_BATCHES = 3;

const PDF_MAGIC = Buffer.from('%PDF-');

// Generic client-facing fallback; real error detail stays in server logs.
const CLIENT_MSG_PROCESSING_FAILED = 'Obrada dokumenta nije uspela';

function countProcessing() {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'processing') count++;
  }
  return count;
}

/** Short content hash for log correlation without leaking filenames. */
function fileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// Admission control — runs BEFORE multer buffers any body bytes
// ---------------------------------------------------------------------------

// Uploads currently streaming in (admitted, response not yet finished).
// Counted together with 'processing' jobs so a burst of concurrent POSTs can
// never buffer more than MAX_ACTIVE_BATCHES bodies into memory — without this,
// multer would buffer up to 20x20MB per request before the batch cap ran.
let inFlightUploads = 0;

function admitUpload(_req, res, next) {
  if (inFlightUploads + countProcessing() >= MAX_ACTIVE_BATCHES) {
    return res.status(429).json({
      error: { code: 'SERVER_BUSY', message: 'Server is busy, please try again in a few minutes' },
    });
  }

  inFlightUploads++;
  let released = false;
  const release = () => {
    if (released) return; // 'finish' and 'close' can both fire — decrement once
    released = true;
    inFlightUploads--;
  };
  res.on('finish', release);
  res.on('close', release);

  next();
}

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  // Busboy decodes multipart filenames as latin1 by default, mangling Serbian
  // characters (š, đ, ž...). Multer 2.x forwards this option to busboy.
  defParamCharset: 'utf8',
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

router.post('/extract', admitUpload, upload.array('files', 20), (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      error: { code: 'NO_FILES', message: 'At least one PDF file is required' },
    });
  }

  // Magic-byte check: mimetype/extension are client-controlled, the buffer isn't.
  for (const file of req.files) {
    if (file.buffer.length < PDF_MAGIC.length
        || !file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      const err = new Error('Only PDF files are accepted');
      err.code = 'INVALID_FILE_TYPE';
      return next(err);
    }
  }

  const batchId = crypto.randomUUID();
  const job = {
    files: req.files,
    fileCount: req.files.length,
    results: [],
    status: 'processing',
    cleanupTimer: null,
    expiryTimer: null,
  };

  // Hard safety expiry from submission time: even if processing hangs, the job
  // (and any buffers it still references) is dropped after JOB_MAX_AGE_MS.
  job.expiryTimer = setTimeout(() => {
    logger.warn({ batchId }, 'Job hit hard safety expiry, deleting');
    job.files = null;
    jobs.delete(batchId);
  }, JOB_MAX_AGE_MS);
  job.expiryTimer.unref();

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
  for (let i = 0; i < job.fileCount; i++) {
    // job.files can be nulled by the safety-expiry timer mid-batch
    const file = job.files && job.files[i];
    if (!file) break;

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
      // Log file index + content hash instead of the filename (filenames are PII);
      // the client only ever sees the short generic message.
      logger.error({ err, batchId, fileIndex: i, fileHash: fileHash(file.buffer) }, 'File processing failed');
      job.results.push({
        filename: file.originalname,
        error: err.clientMessage || CLIENT_MSG_PROCESSING_FAILED,
      });
    }

    // Release this file's buffer as soon as it's done, not at end of batch
    if (job.files) job.files[i] = null;
  }

  // Release PDF buffers from memory now that processing is done
  job.files = null;

  job.status = 'complete';
  logger.info({ batchId, total: job.fileCount, completed: job.results.length }, 'Batch processing complete');

  // The post-complete TTL supersedes the hard safety expiry
  clearTimeout(job.expiryTimer);
  job.expiryTimer = null;

  // Start TTL cleanup AFTER processing completes (not at submission time)
  job.cleanupTimer = setTimeout(() => {
    jobs.delete(batchId);
  }, JOB_TTL_MS);
  job.cleanupTimer.unref();
}

module.exports = router;
