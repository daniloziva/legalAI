'use strict';

// Deterministic Serbian Cyrillic -> Latin transliteration.
// The mapping is 1:1 per character, so running it on Latin text is a no-op —
// safe to apply unconditionally to mixed-script OCR output.
const MAP = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z', И: 'I',
  Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'Č', Џ: 'Dž', Ш: 'Š',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
};

// Uppercase digraph letters need casing context: ЊЕГОШ -> NJEGOŠ, Његош -> Njegoš.
const DIGRAPHS = new Set(['Љ', 'Њ', 'Џ']);

function isUpper(ch) {
  return typeof ch === 'string' && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function toLatin(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const mapped = MAP[ch];
    if (!mapped) {
      out += ch;
      continue;
    }
    if (DIGRAPHS.has(ch) && (isUpper(text[i + 1]) || (!text[i + 1] && isUpper(text[i - 1])))) {
      out += mapped.toUpperCase();
    } else {
      out += mapped;
    }
  }
  return out;
}

function scriptOf(text) {
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (ch >= 'Ѐ' && ch <= 'ӿ') cyr++; // Cyrillic Unicode block
    else if (/[a-zA-ZčćžšđČĆŽŠĐ]/.test(ch)) lat++;
  }
  if (cyr === 0) return 'latin';
  if (lat === 0) return 'cyrillic';
  return 'mixed';
}

/**
 * Transliterate one extraction field ({ value, confidence }) to Latin,
 * preserving the original as `raw` and flagging what happened. Fields flagged
 * `mixed_script` pass through the pipeline — the flag marks them for review.
 */
function normalizeField(field) {
  const script = scriptOf(field.value);
  const flags = [];
  if (script !== 'latin') flags.push('transliterated');
  if (script === 'mixed') flags.push('mixed_script');
  return {
    ...field,
    value: toLatin(field.value),
    raw: field.value,
    flags,
  };
}

module.exports = { toLatin, scriptOf, normalizeField };
