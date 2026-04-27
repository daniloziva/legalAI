'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { generateExcel } = require('../services/excel');

const router = Router();

// --- Zod validation schemas ---

const exportFieldSchema = z.object({
  value: z.string().max(1000),
  confidence: z.enum(['high', 'medium', 'low']),
});

const exportResultSchema = z.object({
  filename: z.string().max(500),
  fields: z.object({
    ban: exportFieldSchema,
    javniIzvrsitelj: exportFieldSchema,
    brojPredmeta: exportFieldSchema,
    iznosPredujma: exportFieldSchema,
    pdvPercent: exportFieldSchema,
    racunPredracun: exportFieldSchema,
    opisUsluge: exportFieldSchema,
    imeStranke: exportFieldSchema,
    imeKlijenta: exportFieldSchema,
  }),
});

const exportRequestSchema = z.object({
  results: z.array(exportResultSchema).min(1),
});

// --- POST /api/export ---

router.post('/export', async (req, res, next) => {
  try {
    const parsed = exportRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid export request body',
          details: parsed.error.issues,
        },
      });
    }

    const buffer = await generateExcel(parsed.data.results);

    const today = new Date().toISOString().slice(0, 10);
    const filename = `A1_takse_${today}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    return res.send(Buffer.from(buffer));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
