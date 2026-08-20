const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { z } = require('zod');
const { env } = require('../config/env');
const { logger } = require('../middleware/requestLogger');
const { normalizeField } = require('../lib/translit');

const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_FIELD_VALUE_LENGTH = 1000;

// Generic, client-safe message — full detail stays in server logs only.
const CLIENT_MSG_EXTRACTION_FAILED = 'Ekstrakcija podataka nije uspela';

/**
 * Build an Error whose `message` (server logs) carries full detail while
 * `clientMessage` is a short generic string safe to show to the client.
 */
function fail(detail) {
  const err = new Error(detail);
  err.clientMessage = CLIENT_MSG_EXTRACTION_FAILED;
  return err;
}

// Load system prompt once at module init
const systemPrompt = fs.readFileSync(
  path.join(__dirname, '..', 'prompts', 'extract-v2.txt'),
  'utf-8',
);

// Zod schema for validating GPT response shape
// Truncate instead of rejecting: a hostile/verbose value should not fail the
// whole file, and the export endpoint enforces a hard .max(1000) anyway.
const fieldSchema = z.object({
  value: z.string().transform((v) => v.slice(0, MAX_FIELD_VALUE_LENGTH)),
  confidence: z.enum(['high', 'medium', 'low']),
});

const extractionSchema = z.object({
  ban:              fieldSchema,
  javniIzvrsitelj:  fieldSchema,
  brojPredmeta:     fieldSchema,
  iznosPredujma:    fieldSchema,
  pdvPercent:       fieldSchema,
  racunPredracun:   fieldSchema,
  opisUsluge:       fieldSchema,
  valuta:           fieldSchema,
  imeStranke:       fieldSchema,
  imeKlijenta:      fieldSchema,
});

/**
 * Send OCR text to Azure OpenAI and return structured extraction results.
 *
 * @param {string} ocrText
 * @returns {Promise<{ fields: object, tokenUsage: { prompt: number, completion: number } }>}
 */
async function extract(ocrText) {
  const url = `${env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${env.AZURE_OPENAI_API_VERSION}`;

  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: ocrText },
    ],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  };

  const headers = {
    'Content-Type': 'application/json',
    'api-key': env.AZURE_OPENAI_KEY,
  };

  let response;
  try {
    response = await axios.post(url, body, { headers, timeout: REQUEST_TIMEOUT_MS });
  } catch (err) {
    // Retry once on 429
    if (err.response && err.response.status === 429) {
      logger.warn('Extraction rate limited (429), retrying once after 5s');
      await sleep(RETRY_DELAY_MS);
      try {
        response = await axios.post(url, body, { headers, timeout: REQUEST_TIMEOUT_MS });
      } catch (retryErr) {
        throw fail(`Extraction API call failed: ${retryErr.response?.status || retryErr.message}`);
      }
    } else {
      throw fail(`Extraction API call failed: ${err.response?.status || err.message}`);
    }
  }

  const usage = response.data.usage;
  const tokenUsage = {
    prompt: usage?.prompt_tokens || 0,
    completion: usage?.completion_tokens || 0,
  };

  logger.info({ tokenUsage }, 'Token usage for extraction');

  // Parse the JSON content from the response
  const rawContent = response.data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw fail('Extraction failed: empty response from model');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw fail('Extraction failed: invalid JSON in model response');
  }

  // Validate shape with Zod
  const result = extractionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.flatten().fieldErrors;
    throw fail(`Extraction failed: response shape invalid — ${JSON.stringify(issues)}`);
  }

  // Deterministic Cyrillic -> Latin transliteration on name fields only —
  // the model returns them verbatim from the document (see extract-v2.txt).
  // brojPredmeta is deliberately NOT transliterated: lawyers search court
  // databases with the exact string as printed, including Cyrillic И.ИВК.
  const fields = {
    ...result.data,
    javniIzvrsitelj: normalizeField(result.data.javniIzvrsitelj),
    imeStranke: normalizeField(result.data.imeStranke),
    imeKlijenta: normalizeField(result.data.imeKlijenta),
  };

  return { fields, tokenUsage };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { extract };
