export const FIELD_KEYS = ['brojPredmeta', 'imeStranke', 'jmbg', 'imeKlijenta', 'iznos'];

export const FIELD_LABELS = {
  brojPredmeta: 'Broj predmeta',
  imeStranke: 'Ime stranke',
  jmbg: 'JMBG',
  imeKlijenta: 'Ime klijenta',
  iznos: 'Iznos',
};

export function truncateName(name, maxLen = 40) {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, maxLen - ext.length - 3);
  return base + '...' + ext;
}

/**
 * Client-side JMBG checksum validation.
 * Mirrors the server-side implementation in server/src/lib/jmbg.js.
 */
export function validateJmbg(jmbg) {
  if (!jmbg || typeof jmbg !== 'string') return false;
  const cleaned = jmbg.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cleaned)) return false;

  const d = cleaned.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  const remainder = sum % 11;

  if (remainder === 1) return false;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  return d[12] === checkDigit;
}
