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

// A1 takse format — 19 columns matching the client template exactly
const COLUMNS = [
  { header: 'Ban', key: 'ban', width: 18 },
  { header: 'Javni izvršitelj', key: 'javniIzvrsitelj', width: 22 },
  { header: 'I.Ivk.br', key: 'iIvkBr', width: 20 },
  { header: 'iznos predujma', key: 'iznosPredujma', width: 16 },
  { header: 'Neto Iznos takse', key: 'netoIznosTakse', width: 16 },
  { header: 'Iznos PDV', key: 'iznosPdv', width: 12 },
  { header: 'Racun/Predracun', key: 'racunPredracun', width: 18 },
  { header: 'Broj fakture', key: 'brojFakture', width: 20 },
  { header: 'datum prijema', key: 'datumPrijema', width: 14 },
  { header: 'kontrola', key: 'kontrola', width: 12 },
  { header: 'advokat', key: 'advokat', width: 12 },
  { header: 'dostava', key: 'dostava', width: 12 },
  { header: 'konacan racun datum', key: 'konacanRacunDatum', width: 18 },
  { header: 'racun / konacni racun ', key: 'racunKonacniRacun', width: 18 },
  { header: 'opis usluge', key: 'opisUsluge', width: 30 },
  { header: 'valuta', key: 'valuta', width: 10 },
  { header: 'Datum slanja u A1', key: 'datumSlanjaA1', width: 18 },
  { header: 'tekući račun', key: 'tekuciRacun', width: 14 },
  { header: 'poziv na broj', key: 'pozivNaBroj', width: 20 },
];

// Dropdown values for opis usluge (data validation)
const OPIS_USLUGE_VALUES = [
  'predujam-pribavljanje podataka',
  'predujam-Pio',
  'predujam-Računi',
  'predujam-Mup',
  'predujam-Popis',
  'predujam-Pojedinačne radnje',
  'inicijalni predujam',
  'nagrada',
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
 * Generate an A1 takse Excel buffer from extraction results.
 *
 * @param {Array} results - Array of extraction result objects
 * @returns {Promise<Buffer>} Excel file as a buffer
 */
async function generateExcel(results) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LegalAI';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('detail');

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

  // Add data rows
  for (const result of results) {
    const { fields } = result;

    // Parse amounts for Neto/PDV calculation
    const iznosPredujma = parseFloat(fields.iznosPredujma.value) || 0;
    const pdvRate = parseFloat(fields.pdvPercent.value) || 20;
    const divisor = 1 + (pdvRate / 100);
    const netoIznos = Math.round((iznosPredujma / divisor) * 100) / 100;
    const iznosPdv = Math.round((iznosPredujma - netoIznos) * 100) / 100;

    const row = sheet.addRow({
      ban: sanitizeForExcel(fields.ban.value),
      javniIzvrsitelj: sanitizeForExcel(fields.javniIzvrsitelj.value),
      iIvkBr: sanitizeForExcel(fields.brojPredmeta.value),
      iznosPredujma,
      netoIznosTakse: netoIznos,
      iznosPdv,
      racunPredracun: sanitizeForExcel(fields.racunPredracun.value),
      brojFakture: sanitizeForExcel(fields.brojPredmeta.value),
      datumPrijema: '',
      kontrola: '',
      advokat: '',
      dostava: '',
      konacanRacunDatum: '',
      racunKonacniRacun: '',
      opisUsluge: sanitizeForExcel(fields.opisUsluge.value),
      valuta: sanitizeForExcel(fields.valuta.value),
      datumSlanjaA1: '',
      tekuciRacun: '',
      pozivNaBroj: sanitizeForExcel(fields.brojPredmeta.value),
    });

    // Alternating row fill
    const dataRowNum = row.number - 1; // 1-based data row index
    const isAlternate = dataRowNum % 2 === 0;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...BASE_FONT };
      cell.border = THIN_BORDER;
      if (isAlternate) {
        cell.fill = ALT_ROW_FILL;
      }
    });

    // Number format for amount columns
    row.getCell('iznosPredujma').numFmt = '#,##0.00';
    row.getCell('netoIznosTakse').numFmt = '#,##0.00';
    row.getCell('iznosPdv').numFmt = '#,##0.00';
  }

  // Add data validation (dropdown) for opis usluge column on data rows
  if (results.length > 0) {
    const opisCol = COLUMNS.findIndex(c => c.key === 'opisUsluge') + 1;
    for (let r = 2; r <= results.length + 1; r++) {
      sheet.getCell(r, opisCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${OPIS_USLUGE_VALUES.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Nevažeća vrednost',
        error: 'Izaberite vrednost iz padajućeg menija.',
      };
    }
  }

  // Add the Sheet1 tab with dropdown source values (matching original template)
  const dropdownSheet = workbook.addWorksheet('Sheet1');
  OPIS_USLUGE_VALUES.forEach((val, idx) => {
    dropdownSheet.getCell(idx + 1, 1).value = val;
  });

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
