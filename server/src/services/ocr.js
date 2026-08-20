const axios = require('axios');
const { env } = require('../config/env');
const { logger } = require('../middleware/requestLogger');

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;
const RETRY_DELAY_MS = 5000;
const SUBMIT_TIMEOUT_MS = 30000;
const POLL_TIMEOUT_MS = 15000;

// Generic, client-safe messages — full detail stays in server logs only.
const CLIENT_MSG_OCR_FAILED = 'OCR obrada nije uspela';
const CLIENT_MSG_NO_TEXT = 'Nema čitljivog teksta u dokumentu';

/**
 * Build an Error whose `message` (server logs) carries full detail while
 * `clientMessage` is a short generic string safe to show to the client.
 */
function fail(detail, clientMessage) {
  const err = new Error(detail);
  err.clientMessage = clientMessage;
  return err;
}

/**
 * Best-effort deletion of the analyze result Azure retains (~24h) at the
 * operation-location URL. The 2024-11-30 GA API accepts DELETE on that URL.
 * Fire-and-forget — must never fail the OCR flow.
 */
function deleteAnalyzeResult(operationLocation) {
  axios.delete(operationLocation, {
    headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY },
    timeout: POLL_TIMEOUT_MS,
  }).catch((err) => {
    logger.warn({ status: err.response?.status }, 'Failed to delete analyze result from Azure DI (best-effort)');
  });
}

/**
 * Send a PDF buffer to Azure Document Intelligence and return the extracted text.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} OCR text content
 */
async function ocr(pdfBuffer) {
  const base64Source = pdfBuffer.toString('base64');
  const url = `${env.AZURE_DI_ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${env.AZURE_DI_API_VERSION}`;

  let response;
  try {
    response = await axios.post(url, { base64Source }, {
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY,
      },
      timeout: SUBMIT_TIMEOUT_MS,
    });
  } catch (err) {
    // Retry once on 429
    if (err.response && err.response.status === 429) {
      logger.warn('OCR rate limited (429), retrying once after 5s');
      await sleep(RETRY_DELAY_MS);
      try {
        response = await axios.post(url, { base64Source }, {
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY,
          },
          timeout: SUBMIT_TIMEOUT_MS,
        });
      } catch (retryErr) {
        throw fail(`OCR submission failed: ${retryErr.response?.status || retryErr.message}`, CLIENT_MSG_OCR_FAILED);
      }
    } else {
      throw fail(`OCR submission failed: ${err.response?.status || err.message}`, CLIENT_MSG_OCR_FAILED);
    }
  }

  const operationLocation = response.headers['operation-location'];
  if (!operationLocation) {
    throw fail('OCR submission did not return an operation-location header', CLIENT_MSG_OCR_FAILED);
  }

  // Poll for result
  let pollErrors = 0;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let pollResponse;
    try {
      pollResponse = await axios.get(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY },
        timeout: POLL_TIMEOUT_MS,
      });
    } catch (pollErr) {
      pollErrors++;
      const status = pollErr.response?.status;
      // Tolerate up to 3 transient errors (429, 5xx, timeout) during polling
      if (pollErrors <= 3 && (status === 429 || (status >= 500 && status < 600) || !status)) {
        logger.warn({ attempt, status, pollErrors }, 'OCR poll transient error, retrying');
        continue;
      }
      throw fail(`OCR polling failed: ${status || pollErr.message}`, CLIENT_MSG_OCR_FAILED);
    }

    const { status } = pollResponse.data;

    if (status === 'succeeded') {
      // Zero-retention: remove the analyze result Azure would otherwise keep.
      deleteAnalyzeResult(operationLocation);

      const text = pollResponse.data.analyzeResult?.content;
      if (!text || text.trim().length === 0) {
        throw fail('No readable text found', CLIENT_MSG_NO_TEXT);
      }
      return text;
    }

    if (status === 'failed') {
      const errorDetail = JSON.stringify(pollResponse.data.error || 'Unknown error');
      throw fail(`OCR analysis failed: ${errorDetail}`, CLIENT_MSG_OCR_FAILED);
    }

    // 'running' or 'notStarted' — keep polling
  }

  throw fail('OCR timed out after 60 seconds', CLIENT_MSG_OCR_FAILED);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ocr };
