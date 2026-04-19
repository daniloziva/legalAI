/**
 * Validate a Serbian JMBG (Jedinstveni Maticni Broj Gradjana).
 *
 * Format: DDMMYYYRRBBBK (13 digits)
 * Checksum: weighted sum mod 11 with remainder-based check digit.
 *
 * @param {string} jmbg
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateJmbg(jmbg) {
  if (!jmbg || typeof jmbg !== 'string') {
    return { valid: false, reason: 'Empty or not a string' };
  }

  const cleaned = jmbg.replace(/\s/g, '');

  if (!/^\d{13}$/.test(cleaned)) {
    return { valid: false, reason: 'Must be exactly 13 digits' };
  }

  const d = cleaned.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  const remainder = sum % 11;

  if (remainder === 1) {
    return { valid: false, reason: 'Invalid checksum (remainder 1)' };
  }

  const checkDigit = remainder === 0 ? 0 : 11 - remainder;

  if (d[12] !== checkDigit) {
    return { valid: false, reason: `Checksum mismatch: expected ${checkDigit}, got ${d[12]}` };
  }

  return { valid: true };
}

module.exports = { validateJmbg };
