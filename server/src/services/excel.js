'use strict';

const ExcelJS = require('exceljs');

/**
 * Sanitize a value before writing to Excel to prevent formula injection.
 * Prefixes dangerous leading characters with a single quote.
 */
function sanitizeForExcel(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

const COLUMNS = [
  { header: '#', key: 'rowNum', width: 5 },
  { header: 'Fajl', key: 'filename', width: 30 },
  { header: 'Broj predmeta', key: 'brojPredmeta', width: 20 },
  { header: 'Ime stranke', key: 'imeStranke', width: 30 },
  { header: 'JMBG', key: 'jmbg', width: 18 },
  { header: 'JMBG validan', key: 'jmbgValid', width: 12 },
  { header: 'Ime klijenta', key: 'imeKlijenta', width: 30 },
  { header: 'Iznos', key: 'iznos', width: 18 },
];

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A5F' },
};

const HEADER_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

const BASE_FONT = {
  name: 'Calibri',
  size: 11,
};

const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

const ALT_ROW_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
};

/**
 * Generate an Excel buffer from extraction results.
 * Skips rows that have an .error property (failed extractions).
 *
 * @param {Array} results - Array of extraction result objects
 * @returns {Promise<Buffer>} Excel file as a buffer
 */
async function generateExcel(results) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LegalAI';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Extracted Data');

  // Define columns
  sheet.columns = COLUMNS;

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Add data rows (Zod validation in the route ensures only valid results arrive here)
  let rowNum = 0;
  for (const result of results) {
    rowNum++;
    const { fields } = result;

    const row = sheet.addRow({
      rowNum,
      filename: sanitizeForExcel(result.filename),
      brojPredmeta: sanitizeForExcel(fields.brojPredmeta.value),
      imeStranke: sanitizeForExcel(fields.imeStranke.value),
      jmbg: sanitizeForExcel(fields.jmbg.value),
      jmbgValid: fields.jmbg.valid === true ? 'Da' : fields.jmbg.valid === false ? 'Ne' : '-',
      imeKlijenta: sanitizeForExcel(fields.imeKlijenta.value),
      iznos: sanitizeForExcel(fields.iznos.value),
    });

    // Format JMBG as text to prevent leading-zero stripping
    row.getCell('jmbg').numFmt = '@';

    // Alternating row fill (even data rows get light gray)
    const isAlternate = rowNum % 2 === 0;

    row.eachCell((cell) => {
      cell.font = { ...BASE_FONT };
      cell.border = THIN_BORDER;
      if (isAlternate) {
        cell.fill = ALT_ROW_FILL;
      }
    });

    // JMBG validan column color: green for Da, red for Ne, default for unknown
    const jmbgValidCell = row.getCell('jmbgValid');
    if (fields.jmbg.valid === true) {
      jmbgValidCell.font = { ...BASE_FONT, color: { argb: 'FF16A34A' } };
    } else if (fields.jmbg.valid === false) {
      jmbgValidCell.font = { ...BASE_FONT, color: { argb: 'FFDC2626' } };
    }
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
