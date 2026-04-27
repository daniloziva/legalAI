export const FIELD_KEYS = [
  'ban',
  'javniIzvrsitelj',
  'brojPredmeta',
  'iznosPredujma',
  'pdvPercent',
  'racunPredracun',
  'opisUsluge',
  'imeStranke',
  'imeKlijenta',
];

export const FIELD_LABELS = {
  ban: 'Ban',
  javniIzvrsitelj: 'Javni izvršitelj',
  brojPredmeta: 'I.Ivk.br',
  iznosPredujma: 'Iznos predujma',
  pdvPercent: 'PDV %',
  racunPredracun: 'Račun/Predračun',
  opisUsluge: 'Opis usluge',
  imeStranke: 'Ime stranke',
  imeKlijenta: 'Ime klijenta',
};

export function truncateName(name, maxLen = 40) {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, maxLen - ext.length - 3);
  return base + '...' + ext;
}
