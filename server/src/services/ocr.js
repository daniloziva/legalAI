const axios = require('axios');
const { env } = require('../config/env');
const { logger } = require('../middleware/requestLogger');

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;
const RETRY_DELAY_MS = 5000;

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
    });
  } catch (err) {
    // Retry once on 429
    if (err.response && err.response.status === 429) {
      logger.warn('OCR rate limited (429), retrying once after 5s');
      await sleep(RETRY_DELAY_MS);
      response = await axios.post(url, { base64Source }, {
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY,
        },
      });
    } else {
      throw new Error(`OCR submission failed: ${err.response?.status || err.message}`);
    }
  }

  const operationLocation = response.headers['operation-location'];
  if (!operationLocation) {
    throw new Error('OCR submission did not return an operation-location header');
  }

  // Poll for result
  let pollErrors = 0;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let pollResponse;
    try {
      pollResponse = await axios.get(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY },
      });
    } catch (pollErr) {
      pollErrors++;
      const status = pollErr.response?.status;
      // Tolerate up to 3 transient errors (429, 5xx) during polling
      if (pollErrors <= 3 && (status === 429 || (status >= 500 && status < 600) || !status)) {
        logger.warn({ attempt, status, pollErrors }, 'OCR poll transient error, retrying');
        continue;
      }
      throw new Error(`OCR polling failed: ${status || pollErr.message}`);
    }

    const { status } = pollResponse.data;

    if (status === 'succeeded') {
      const text = pollResponse.data.analyzeResult?.content;
      if (!text || text.trim().length === 0) {
        throw new Error('No readable text found');
      }
      return text;
    }

    if (status === 'failed') {
      const errorDetail = JSON.stringify(pollResponse.data.error || 'Unknown error');
      throw new Error(`OCR analysis failed: ${errorDetail}`);
    }

    // 'running' or 'notStarted' — keep polling
  }

  throw new Error('OCR timed out after 60 seconds');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ocr };
