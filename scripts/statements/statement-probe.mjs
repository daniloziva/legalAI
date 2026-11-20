#!/usr/bin/env node
// Bank statement PDF parser: probe any PDF, parse known layouts, and refuse to
// return data it cannot fully account for.
//
// Install (exact versions, no install scripts, no optional native packages):
//   npm ci --omit=optional --ignore-scripts        (with the package.json + package-lock.json next to this file)
//
// Run:
//   node statement-probe.mjs izvod.pdf                      parse + checks
//   node statement-probe.mjs izvod.pdf --json out.json      also write the result (refuses to overwrite; add --force)
//   node statement-probe.mjs izvod.pdf --lines              also print every text line (for adding a layout)
//
// Exit codes: 0 ok · 1 usage · 2 no text layer (scan) · 3 checks failed · 4 PDF unreadable · 5 layout unknown
// Everything runs locally; no network calls.

import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';

const PARSER_VERSION = '3.0.0';
const EXIT = { OK: 0, USAGE: 1, SCAN: 2, CHECKS: 3, UNREADABLE: 4, UNKNOWN_LAYOUT: 5 };

// ───────────────────────── CLI ─────────────────────────
let opts;
try {
  opts = parseArgs({
    allowPositionals: true,
    options: { json: { type: 'string' }, lines: { type: 'boolean', default: false }, force: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } },
  });
} catch (e) { usage(e.message); }
const { values: flags, positionals } = opts;
if (flags.help) usage();
if (positionals.length !== 1) usage(positionals.length ? 'Give exactly one PDF file.' : 'No PDF file given.');
const file = positionals[0];
if (flags.json !== undefined) {
  if (!flags.json.toLowerCase().endsWith('.json')) usage('--json needs an output path ending in .json');
  if (path.resolve(flags.json) === path.resolve(file)) usage('--json output must not be the input file');
  if (!flags.force && await exists(flags.json)) usage(`${flags.json} already exists (add --force to overwrite)`);
}
function usage(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error('Usage: node statement-probe.mjs <statement.pdf> [--json out.json] [--force] [--lines]');
  process.exit(EXIT.USAGE);
}
async function exists(p) { try { await access(p); return true; } catch { return false; } }

// ───────────────────────── helpers ─────────────────────────
const SEP = '[.\\u00A0\\u202F ]';                                   // thousands separators seen in practice
const AMOUNT_RE = new RegExp(`^[-\\u2212]?\\d{1,3}(?:${SEP}\\d{3})*,\\d{2}$`);
const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/;
const ACCOUNT_RE = /\b(\d{3})-(\d{1,13})-(\d{2})\b/;
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj').toLowerCase();
const toCents = (s) => {                                            // exact: string → integer cents, no floats
  if (!AMOUNT_RE.test(s)) throw new Error(`not an amount: "${s}"`);
  const neg = /^[-−]/.test(s);
  const [int, dec] = s.replace(/^[-−]/, '').replace(new RegExp(SEP, 'g'), '').split(',');
  const c = Number(int) * 100 + Number(dec);
  if (!Number.isSafeInteger(c)) throw new Error(`amount too large: "${s}"`);
  return neg ? -c : c;
};
const fmt = (c) => (c < 0 ? '-' : '') + (Math.floor(Math.abs(c) / 100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + String(Math.abs(c) % 100).padStart(2, '0');
const dec = (c) => (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0');
const isoDate = (s) => {
  const m = String(s).match(DATE_RE); if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;  // rejects 32.13.2026
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
// Serbian account: bank(3) + number(13, zero-padded) + control(2); control = 98 − (first16 × 100 mod 97)
const accountOk = (a) => {
  const m = a && a.match(ACCOUNT_RE); if (!m) return false;
  const first16 = m[1] + m[2].padStart(13, '0');
  return 98n - (BigInt(first16) * 100n % 97n) === BigInt(m[3]);
};
const ibanOk = (iban) => {
  if (!/^RS\d{20}$/.test(iban || '')) return false;
  const r = iban.slice(4) + '2728' + iban.slice(2, 4);                // R=27, S=28
  return BigInt(r) % 97n === 1n;
};

// Any ISO 4217 currency is accepted; nothing needs coding when a CHF or GBP account arrives.
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ───────────────────────── read the PDF ─────────────────────────
// pdfjs tries to load a native canvas package on import; it is only needed for drawing pages, not reading text.
// Those three load-time notices are expected and silenced; any other import-time message is shown.
const IMPORT_NOISE = /Cannot load "@napi-rs\/canvas"|Cannot polyfill `(DOMMatrix|ImageData|Path2D)`/;
const pdfjs = await (async () => {
  const [l, w] = [console.log, console.warn];
  const filter = (orig) => (...a) => { if (!IMPORT_NOISE.test(a.join(' '))) orig(...a); };
  console.log = filter(l); console.warn = filter(w);
  try { return await import('pdfjs-dist/legacy/build/pdf.mjs'); } finally { console.log = l; console.warn = w; }
})();
// The 14 standard PDF fonts ship with pdfjs-dist; without them pdfjs warns and may measure text badly.
const STANDARD_FONTS = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const data = new Uint8Array(await readFile(file).catch((e) => { console.error(`Cannot read ${file}: ${e.message}`); process.exit(EXIT.UNREADABLE); }));
const sha256 = createHash('sha256').update(data).digest('hex');

// pdfjs reports problems with console.log("Warning: …"); capture them instead of losing them
const pdfWarnings = [];
const origLog = console.log;
const capture = async (fn) => {
  console.log = (...a) => { const s = a.join(' '); if (/^Warning:/.test(s)) pdfWarnings.push(s); else origLog(...a); };
  try { return await fn(); } finally { console.log = origLog; }
};

let doc;
try {
  doc = await capture(() => pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, stopAtErrors: true,
    verbosity: pdfjs.VerbosityLevel.WARNINGS, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS,
  }).promise);
} catch (e) {
  console.error(e?.name === 'PasswordException' ? `${file} is password-protected.` : `${file} is not a readable PDF: ${e?.message || e}`);
  process.exit(EXIT.UNREADABLE);
}

const items = [];
const pageSize = {};
let notUpright = 0, offPage = 0;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });                        // applies /Rotate (UniCredit: 270°)
  pageSize[p] = { w: vp.width, h: vp.height };
  const { items: raw } = await capture(() => page.getTextContent());
  const pageItems = [];
  for (const it of raw) {
    if (!it.str || !it.str.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform);       // device space: x right, y down
    const size = Math.hypot(t[2], t[3]) || 1;
    if (Math.abs(t[1]) > 0.05 * size || Math.abs(t[2]) > 0.05 * size || t[0] <= 0) { notUpright++; continue; }
    const scale = Math.hypot(t[0], t[1]) / (Math.hypot(it.transform[0], it.transform[1]) || 1);
    const item = { page: p, x: t[4], y: t[5] - size * 0.8, w: it.width * scale, size, str: it.str.replace(/\s+/g, ' ').trim() };
    if (item.x < -1 || item.x + item.w > vp.width + 1 || item.y < -size || item.y > vp.height + 1) { offPage++; continue; }
    pageItems.push(item);
  }
  // Overprinted "bold": the same text drawn 2–3× within ~1.5pt, sometimes split differently ("IZVOD 061" vs "IZVOD"+"061").
  // Keep the longest strings first; drop any item whose box and text are contained in an item already kept.
  pageItems.sort((a, b) => b.str.length - a.str.length || a.y - b.y || a.x - b.x);
  const kept = [];
  for (const it of pageItems) {
    const dup = kept.some((k) => Math.abs(k.y - it.y) < 1.5 && it.x >= k.x - 1.5 && it.x + it.w <= k.x + k.w + 1.5 && k.str.includes(it.str));
    if (!dup) kept.push(it);
  }
  items.push(...kept);
}
if (notUpright) fail(`${notUpright} text item(s) are rotated relative to the page (stamp or unexpected layout)`);
if (offPage) fail(`${offPage} text item(s) lie outside the page area`);
if (pdfWarnings.length) fail(`PDF reader warnings: ${[...new Set(pdfWarnings)].slice(0, 5).join(' | ')}`);

const chars = items.reduce((a, i) => a + i.str.length, 0);
origLog(`\n${file}\nsha256 ${sha256}\n${doc.numPages} page(s), ${items.length} text items after removing overprinted copies`);
if (chars < 40) {
  origLog('\n⚠ Almost no text layer: this PDF is most likely a scan and needs OCR.');
  process.exit(EXIT.SCAN);
}

// ───────────────────────── lines and cells ─────────────────────────
const lines = [];
for (const it of [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
  const last = lines[lines.length - 1];
  if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
  else lines.push({ page: it.page, y: it.y, items: [it] });
}
for (const l of lines) {
  l.items.sort((a, b) => a.x - b.x);
  l.cells = [];
  l.overlap = false;
  for (const it of l.items) {
    const c = l.cells[l.cells.length - 1];
    const gap = c ? it.x - (c.x + c.w) : Infinity;
    if (gap < -1) l.overlap = true;                                   // text drawn over other text
    if (c && gap < 4) { c.str += (gap > 1 ? ' ' : '') + it.str; c.w = Math.max(c.w, it.x + it.w - c.x); }
    else l.cells.push({ x: it.x, w: it.w, str: it.str });
  }
  l.plain = l.cells.map((c) => c.str).join(' ');
  l.text = l.cells.map((c) => c.str).join(' | ');
  l.f = fold(l.plain);
}
if (flags.lines) {
  origLog('\n── Lines (page:y  x of first cell  cells separated by |) ──');
  for (const l of lines) origLog(`${l.page}:${String(Math.round(l.y)).padStart(4)}  x${String(Math.round(l.cells[0].x)).padStart(4)}  ${l.text}`);
}

// ───────────────────────── layouts ─────────────────────────
const LAYOUTS = [
  {
    name: 'unicredit-rs-daily', bank: 'UniCredit Bank Srbija',
    detect: () => lines.some((l) => /^izvod broj .*unicredit bank srbija/.test(l.f)) && lines.some((l) => l.f.includes('stanje i promene sredstava')),
    parse: parseUniCredit,
  },
];

function parseUniCredit() {
  const res = { header: {}, tx: [], totals: null };
  const h = res.header;

  // ── one statement per file ──
  const titles = lines.filter((l) => l.f.includes('stanje i promene sredstava'));
  if (titles.length !== 1) fail(`expected 1 statement in the file, found ${titles.length}`);

  // ── header ──
  const p1 = lines.filter((l) => l.page === 1);
  const titleLine = p1.find((l) => /\bizvod \d+\b/.test(l.f));
  h.statementNo = titleLine ? titleLine.f.match(/\bizvod (\d+)\b/)[1] : null;
  const dateM = (titles[0]?.plain || '').match(/NA DAN\s+(\d{1,2}\.\d{1,2}\.\d{4})/);
  h.date = dateM ? isoDate(dateM[1]) : null;
  const zr = p1.map((l) => l.plain.match(/Z\.R\.\s*(\d{3}-\d{1,13}-\d{2})/)).find(Boolean);
  h.account = zr ? zr[1] : null;
  const ib = p1.map((l) => l.plain.match(/IBAN\s+(RS\d{20})\b/)).find(Boolean);
  h.iban = ib ? ib[1] : null;
  // Foreign-currency statements may print no "Z.R." line; the domestic account is then read from the IBAN
  // (RS + 2 check digits + bank 3 + account 13 + control 2).
  h.accountSource = h.account ? 'Z.R.' : null;
  if (!h.account && h.iban) {
    h.account = `${h.iban.slice(4, 7)}-${h.iban.slice(7, 20).replace(/^0+(?=\d)/, '')}-${h.iban.slice(20, 22)}`;
    h.accountSource = 'IBAN';
  }

  // STANJE block: header words → values below them, matched by column position
  const stHead1 = p1.find((l) => l.f.startsWith('prethodno'));
  const stHead2 = stHead1 && p1[p1.indexOf(stHead1) + 1];
  const stVals = stHead2 && p1[p1.indexOf(stHead2) + 1];
  // the closing-balance column ("novo stanje") is headed by the account currency: RSD, EUR, CHF, GBP…
  const want = { opening: 'stanje', debitTotal: 'duguje', creditTotal: 'potrazuje', closing: '[a-z]{3}', debitCount: 'zaduzenja', creditCount: 'odobrenja' };
  if (!stHead2 || !stVals) fail('STANJE block not found');
  else {
    const centre = (c) => c.x + c.w / 2;
    const anchors = {};
    for (const [k, word] of Object.entries(want)) {
      const c = stHead2.cells.find((c) => new RegExp(`^${word}$`).test(fold(c.str)));
      if (!c) { fail(`STANJE header "${word}" not found`); continue; }
      anchors[k] = centre(c);
      if (k === 'closing') h.currency = c.str.toUpperCase();
    }
    const used = new Set();
    for (const v of stVals.cells) {
      const nearest = Object.entries(anchors).sort((a, b) => Math.abs(a[1] - centre(v)) - Math.abs(b[1] - centre(v)))[0];
      if (!nearest) continue;
      const [k] = nearest;
      if (used.has(k)) { fail(`STANJE: two values under "${want[k]}"`); continue; }
      used.add(k);
      if (k.endsWith('Count')) { if (/^\d{1,6}$/.test(v.str)) h[k] = Number(v.str); else fail(`STANJE ${k} is not a number: "${v.str}"`); }
      else { try { h[k] = toCents(v.str); } catch (e) { fail(`STANJE ${k}: ${e.message}`); } }
    }
    for (const k of Object.keys(want)) if (h[k] == null) fail(`STANJE ${k} missing`);
  }

  // ── per page: table header (column positions) and footer ──
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pl = lines.filter((l) => l.page === p);
    const r1 = pl.findIndex((l) => /^redni\b.*\biznos\b.*\bpodaci$/.test(l.f));
    const hdr = r1 >= 0 ? pl.slice(r1, r1 + 4) : [];
    const endHdr = hdr[3];
    const ok = hdr.length === 4 && /^broj\b.*\bsifra\b.*\bsvrha\b/.test(hdr[1].f) && /\bzaduzenje\b.*\bodobrenje\b/.test(hdr[2].f) && endHdr.f === '(odobrenja)';
    if (!ok) { fail(`page ${p}: table header not found where expected`); continue; }
    // x of a header word; a cell may hold several words ("poreklo naloga"), so place the word inside it by its character offset
    const at = (li, word) => {
      for (const c of hdr[li].cells) {
        const f = fold(c.str), i = f.split(' ').indexOf(word);
        if (i < 0) continue;
        const off = f.split(' ').slice(0, i).join(' ').length + (i ? 1 : 0);
        return c.x + c.w * (off / f.length);
      }
      fail(`page ${p}: header word "${word}" missing`); return NaN;
    };
    const col = {                                                     // left edges of each column, from the header words
      name: at(0, 'redni') + 21,
      origin: at(0, 'poreklo') - 18,
      amount: at(2, 'zaduzenje') - 18,
      credit: at(2, 'odobrenje') - 15,                               // amount whose right edge passes this = credit column
      code: at(1, 'sifra') - 20,
      purpose: at(1, 'svrha') - 40,
      ref: at(0, '(model)') - 18,
      complaint: at(0, 'podaci') - 43,
    };
    const order = ['name', 'origin', 'amount', 'credit', 'code', 'purpose', 'ref', 'complaint'];
    if (order.some((k, i) => !Number.isFinite(col[k]) || (i && col[k] <= col[order[i - 1]]))) { fail(`page ${p}: column positions are not in order`); continue; }
    const foot = pl.find((l) => /^izvod broj (\d+) za racun (\d+) unicredit bank srbija a\.d\. strana (\d+)$/.test(l.f));
    if (!foot) { fail(`page ${p}: footer "Izvod broj … Strana …" not found`); continue; }
    const fm = foot.f.match(/^izvod broj (\d+) za racun (\d+) .* strana (\d+)$/);
    if (fm[1] !== h.statementNo) fail(`page ${p}: footer statement ${fm[1]} ≠ header ${h.statementNo}`);
    if (Number(fm[3]) !== p) fail(`page ${p}: footer says page ${Number(fm[3])}`);
    if (h.account && !h.account.replace(/-/g, '').includes(fm[2])) fail(`page ${p}: footer account ${fm[2]} not in ${h.account}`);
    pages.push({ p, top: endHdr.y, bottom: foot.y, col, lines: pl.filter((l) => l.y > endHdr.y + 1 && l.y < foot.y - 1) });
  }

  const colOf = (col, x) => x >= col.complaint ? 'complaint' : x >= col.ref ? 'ref' : x >= col.purpose ? 'purpose' : x >= col.code ? 'code'
    : x >= col.amount ? 'amount' : x >= col.origin ? 'origin' : x >= col.name ? 'name' : 'no';

  // ── rows ──
  let cur = null, state = 'before';                                  // before → records → totals → done
  const flush = () => { if (cur) res.tx.push(cur); cur = null; };
  for (const pg of pages) {
    for (const l of pg.lines) {
      if (l.overlap) fail(`page ${pg.p} y${Math.round(l.y)}: overlapping text "${l.plain}"`);
      if (state === 'done') { fail(`page ${pg.p}: text after the totals row: "${l.plain}"`); continue; }
      if (state === 'totals') {
        const m = l.plain.match(/^\(ukupno (\d+) naloga\) Ukupno (\S+) (\S+)$/i);
        if (!m || !AMOUNT_RE.test(m[2]) || !AMOUNT_RE.test(m[3])) { fail(`totals row not as expected: "${l.plain}"`); state = 'done'; continue; }
        res.totals = { count: Number(m[1]), debit: toCents(m[2]), credit: toCents(m[3]) };
        state = 'done'; continue;
      }
      if (/^ukupno na racunu \d+$/.test(l.f)) {
        flush(); state = 'totals';
        if (h.account && !h.account.replace(/-/g, '').includes(l.f.match(/(\d+)$/)[1])) fail(`totals account ${l.f} ≠ ${h.account}`);
        continue;
      }
      const first = l.cells[0];
      if (/^\d{6}$/.test(first.str) && colOf(pg.col, first.x) === 'no') {
        flush(); state = 'records';
        cur = { no: first.str, page: pg.p, lineIdx: 0, nameLines: [], originParts: [], dates: [], amounts: [], codes: [], purposeParts: [], refLines: [], complaintLines: [] };
      } else if (!cur) { fail(`page ${pg.p}: text before the first transaction: "${l.plain}"`); continue; }
      else cur.lineIdx++;

      const nameWords = [], refWords = [], complaintWords = [];
      for (const c of l.cells) {
        const k = colOf(pg.col, c.x), kEnd = colOf(pg.col, c.x + c.w - 0.5);
        if (c === first && k === 'no' && /^\d{6}$/.test(c.str)) continue;
        if (k === 'no') { fail(`${cur.no}: unexpected text in the number column: "${c.str}"`); continue; }
        if (k !== kEnd && !(k === 'amount' && kEnd === 'amount') && k !== 'complaint') fail(`${cur.no}: "${c.str}" crosses from ${k} into ${kEnd}`);
        if (k === 'name') nameWords.push(c.str);
        else if (k === 'origin') { const d = isoDate(c.str); if (d) cur.dates.push(d); else if (DATE_RE.test(c.str)) fail(`${cur.no}: invalid date "${c.str}"`); else cur.originParts.push(c.str); }
        else if (k === 'amount') {
          if (!AMOUNT_RE.test(c.str)) { fail(`${cur.no}: non-amount text in the amount column: "${c.str}"`); continue; }
          cur.amounts.push({ cents: toCents(c.str), side: c.x + c.w > pg.col.credit ? 'credit' : 'debit', raw: c.str });
        }
        else if (k === 'code') cur.codes.push(c.str);
        else if (k === 'purpose') cur.purposeParts.push(c.str);
        else if (k === 'ref') refWords.push(c.str);
        else if (k === 'complaint') complaintWords.push(c.str);
      }
      if (nameWords.length) cur.nameLines.push(nameWords.join(' '));
      if (refWords.length) cur.refLines.push({ idx: cur.lineIdx, text: refWords.join(' ') });
      if (complaintWords.length) cur.complaintLines.push({ idx: cur.lineIdx, text: complaintWords.join(' ') });
    }
  }
  flush();
  if (!res.totals) fail('totals row ("Ukupno na racunu … / (ukupno N naloga) Ukupno …") not found');

  // ── shape each record and validate it ──
  res.tx = res.tx.map((r) => {
    const t = { no: r.no, page: r.page };
    if (r.amounts.length !== 1) fail(`${r.no}: expected 1 amount, found ${r.amounts.length}`);
    const a = r.amounts[0];
    if (a) {
      t.side = a.side;
      t.amountCents = Math.abs(a.cents);
      t.amount = dec(t.amountCents);
      if (a.side === 'debit' && a.cents > 0) fail(`${r.no}: debit printed without minus (${a.raw})`);
      if (a.side === 'credit' && a.cents < 0) fail(`${r.no}: credit printed with minus (${a.raw}) — reversal?`);
      if (a.cents === 0) fail(`${r.no}: zero amount`);
    }
    if (r.dates.length !== 1) fail(`${r.no}: expected 1 booking date, found ${r.dates.length}`);
    t.bookingDate = r.dates[0] || null;
    if (t.bookingDate && h.date && t.bookingDate !== h.date) fail(`${r.no}: booking date ${t.bookingDate} ≠ statement date ${h.date}`);
    t.origin = r.originParts.join(' ');
    if (r.codes.length > 1) fail(`${r.no}: more than one payment code`);
    t.paymentCode = r.codes[0] || null;
    if (t.paymentCode && !/^\d{3}$/.test(t.paymentCode)) fail(`${r.no}: payment code "${t.paymentCode}" is not 3 digits`);
    t.purpose = r.purposeParts.join(' ');

    // name column: transfer (has an account), card payment, or bank charge
    const accIdx = r.nameLines.findIndex((s) => ACCOUNT_RE.test(s) && s.match(ACCOUNT_RE)[0] === s.trim());
    if (/^Card:/.test(r.nameLines[0] || '')) {
      t.kind = 'card';
      t.cardMasked = r.nameLines[0].replace(/^Card:\s*/, '');
      const m = (r.nameLines[1] || '').match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(.+)$/);
      t.cardDate = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
      t.counterparty = m ? m[4] : (r.nameLines[1] || '');
      t.details = r.nameLines.slice(2).join(' · ');
      if (!m) fail(`${r.no}: card payment without "YYYY.MM.DD merchant" line`);
    } else if (accIdx >= 0) {
      t.kind = 'transfer';
      t.counterparty = r.nameLines.slice(0, accIdx).join(' ');
      t.counterpartyAccount = r.nameLines[accIdx].trim();
      t.details = r.nameLines.slice(accIdx + 1).join(' · ');
      if (!accountOk(t.counterpartyAccount)) warn(`${r.no}: counterparty account ${t.counterpartyAccount} fails the control-digit check`);
      if (!t.paymentCode) fail(`${r.no}: transfer without payment code`);
    } else {
      t.kind = 'bank';
      t.counterparty = r.nameLines[0] || '';
      t.details = r.nameLines.slice(1).join(' · ');
      const izv = t.details.match(/\+IZV\s+(\d+)/);
      t.relatesToBankRef = izv ? izv[1] : null;
    }
    if (!t.counterparty) fail(`${r.no}: no counterparty`);

    // reference column: line 1 = poziv na broj zaduženja, line 2 = poziv na broj odobrenja
    // complaint column: line 1 = bank transaction id, line 2 = bank order reference (11 digits)
    for (const x of [...r.refLines, ...r.complaintLines]) if (x.idx > 1) fail(`${r.no}: unexpected 3rd line in reference/complaint column: "${x.text}"`);
    t.referenceDebit = r.refLines.find((x) => x.idx === 0)?.text || null;
    t.referenceCredit = r.refLines.find((x) => x.idx === 1)?.text || null;
    t.bankTxId = r.complaintLines.find((x) => x.idx === 0)?.text || null;
    let orderRef = r.complaintLines.find((x) => x.idx === 1)?.text || null;
    t.referenceTruncated = false;
    // The bank prints at most 22 characters of a reference; the 23rd spills into the next column
    // and the rest is lost (seen on real statements). Move the spilled character back and flag it.
    for (const key of ['referenceDebit', 'referenceCredit']) if (t[key] && t[key].length >= 22) t.referenceTruncated = true;
    if (orderRef && /^\d{12}$/.test(orderRef) && t.referenceTruncated) {
      const key = t.referenceCredit && t.referenceCredit.length >= 22 ? 'referenceCredit' : 'referenceDebit';
      t[key] += orderRef[0];
      orderRef = orderRef.slice(1);
      warn(`${r.no}: reference cut off by the bank ("${t[key]}…"); do not exact-match it`);
    }
    t.bankOrderRef = orderRef;
    if (t.bankTxId && !/^\d{13,14}$/.test(t.bankTxId)) fail(`${r.no}: bank transaction id "${t.bankTxId}" has an unexpected shape`);
    // domestic orders: 11 digits; foreign (FX) payments: "R. " + the bank's payment number
    if (orderRef && !/^(\d{11}|R\. ?\d{6,12})$/.test(orderRef)) fail(`${r.no}: bank order reference "${orderRef}" has an unexpected shape`);
    return t;
  });

  // ── statement-level checks ──
  const sum = (side) => res.tx.filter((t) => t.side === side).reduce((a, t) => a + t.amountCents, 0);
  const debit = sum('debit'), credit = sum('credit');
  const nD = res.tx.filter((t) => t.side === 'debit').length, nC = res.tx.filter((t) => t.side === 'credit').length;
  const checks = [];
  const check = (ok, text) => { checks.push({ ok, text }); if (!ok) fail(text); };
  const need = ['statementNo', 'date', 'account', 'iban', 'currency', 'opening', 'debitTotal', 'creditTotal', 'closing', 'debitCount', 'creditCount'];
  check(need.every((k) => h[k] != null), `header complete (${need.filter((k) => h[k] == null).join(', ') || 'all fields'})`);
  check(ISO_CURRENCIES.has(h.currency), `currency ${h.currency} is a valid ISO 4217 code`);
  if (h.account && h.iban) {
    const m = h.account.match(ACCOUNT_RE);
    check(h.iban.slice(4) === m[1] + m[2].padStart(13, '0') + m[3], `IBAN ${h.iban} matches account ${h.account}`);
    if (!ibanOk(h.iban)) warn(`IBAN ${h.iban} fails the mod-97 check`);
    if (!accountOk(h.account)) warn(`account ${h.account} fails the control-digit check`);
  }
  // money checks need only the money fields, so a missing account or IBAN never hides a wrong amount
  if (['opening', 'debitTotal', 'creditTotal', 'closing', 'debitCount', 'creditCount'].every((k) => h[k] != null)) {
    check(h.debitTotal <= 0 && h.creditTotal >= 0, 'header signs: duguje ≤ 0, potražuje ≥ 0');
    check(h.opening + h.debitTotal + h.creditTotal === h.closing, `opening ${fmt(h.opening)} ${fmt(h.debitTotal)} + ${fmt(h.creditTotal)} = closing ${fmt(h.closing)}`);
    check(debit === -h.debitTotal, `debit lines ${fmt(debit)} = header duguje ${fmt(-h.debitTotal)}`);
    check(credit === h.creditTotal, `credit lines ${fmt(credit)} = header potražuje ${fmt(h.creditTotal)}`);
    check(h.opening - debit + credit === h.closing, `opening − debit lines + credit lines = closing (${fmt(h.opening - debit + credit)})`);
    check(nD === h.debitCount && nC === h.creditCount, `line counts ${nD} debit / ${nC} credit = header ${h.debitCount} / ${h.creditCount}`);
  }
  if (res.totals) {
    check(res.totals.count === res.tx.length, `"(ukupno ${res.totals.count} naloga)" = ${res.tx.length} transactions`);
    if (h.currency === 'RSD') {
      check(-res.totals.debit === debit && res.totals.credit === credit, `"Ukupno" row ${fmt(res.totals.debit)} / ${fmt(res.totals.credit)} = lines`);
    } else {
      // On foreign-currency statements the bank prints the "Ukupno" row in dinars (RSD equivalent).
      // We can't check it to the cent without the bank's rate, so check that both sides imply the same rate,
      // allowing for each RSD figure having been rounded to the cent.
      const pairs = [[-res.totals.debit, debit], [res.totals.credit, credit]].filter(([rsd, fx]) => fx !== 0 || rsd !== 0);
      const bad = pairs.find(([rsd, fx]) => (fx === 0) !== (rsd === 0) || rsd < 0);
      if (bad) check(false, `"Ukupno" row (RSD) has an amount where the ${h.currency} lines have none, or the reverse`);
      else if (pairs.length) {
        const rates = pairs.map(([rsd, fx]) => ({ rate: rsd / fx, tol: 0.5 / fx + 1e-9 }));
        const lo = Math.max(...rates.map((r) => r.rate - r.tol)), hi = Math.min(...rates.map((r) => r.rate + r.tol));
        res.totals.currency = 'RSD';
        res.totals.impliedRate = Number(((lo + hi) / 2).toFixed(6));
        check(lo <= hi, `"Ukupno" row in RSD (${fmt(res.totals.debit)} / ${fmt(res.totals.credit)}) is consistent with one rate, ${res.totals.impliedRate} RSD per ${h.currency}`);
        warn(`"Ukupno" row is the RSD equivalent at ${res.totals.impliedRate} RSD/${h.currency}; compare with the NBS rate for ${h.date}`);
      }
    }
  }
  const seqOk = res.tx.every((t, i) => Number(t.no) === i + 1);
  check(seqOk, `transaction numbers run 000001…${String(res.tx.length).padStart(6, '0')} without gaps or repeats`);
  check(res.tx.every((t) => t.amountCents != null && t.side && t.bookingDate), 'every transaction has one amount, a side and a booking date');
  const refs = new Set(res.tx.map((t) => t.bankOrderRef).filter(Boolean));
  for (const t of res.tx) if (t.relatesToBankRef && !refs.has(t.relatesToBankRef)) warn(`${t.no}: charge refers to +IZV ${t.relatesToBankRef}, not on this statement`);
  res.checks = checks;
  return res;
}

// ───────────────────────── run ─────────────────────────
const layout = LAYOUTS.find((L) => L.detect());
let result = null;
if (!layout) {
  origLog('\nLayout not recognised. Run with --lines and add a parser to LAYOUTS.');
  for (const l of lines.filter((l) => l.cells.some((c) => AMOUNT_RE.test(c.str))).slice(0, 15)) origLog(`  ${l.page}:${Math.round(l.y)}  ${l.text}`);
} else {
  result = layout.parse();
  const h = result.header;
  origLog(`\nLayout: ${layout.name} (${layout.bank}) · parser ${PARSER_VERSION} · pdfjs ${pdfjs.version}`);
  origLog(`Statement ${h.statementNo} · ${h.date} · account ${h.account} · ${h.iban} · ${h.currency}`);
  if (h.opening != null) origLog(`Opening ${fmt(h.opening)} · duguje ${fmt(h.debitTotal)} (${h.debitCount}) · potražuje ${fmt(h.creditTotal)} (${h.creditCount}) · closing ${fmt(h.closing)}`);
  origLog(`\n── ${result.tx.length} transactions ──`);
  for (const t of result.tx) {
    origLog(`${t.no}  ${t.bookingDate}  ${t.side === 'credit' ? 'credit' : 'debit '} ${(t.amountCents != null ? fmt(t.amountCents) : '?').padStart(14)}  ${(t.paymentCode || '').padEnd(3)}  ${t.kind.padEnd(8)}  ${t.counterparty.slice(0, 40).padEnd(40)}  ${t.counterpartyAccount || ''}`);
    const extra = [t.purpose && `svrha: ${t.purpose}`, t.referenceDebit && `poziv (zad.): ${t.referenceDebit}`, t.referenceCredit && `poziv (odob.): ${t.referenceCredit}${t.referenceTruncated ? ' [skraćeno]' : ''}`,
      t.cardMasked && `kartica: ${t.cardMasked} ${t.cardDate || ''}`, t.details && `detalji: ${t.details}`, `banka: ${[t.bankTxId, t.bankOrderRef].filter(Boolean).join(' / ')}`].filter(Boolean).join(' · ');
    origLog(`        ${extra}`);
  }
  origLog('\n── Checks ──');
  for (const c of result.checks) origLog(`${c.ok ? '✓' : '✗'} ${c.text}`);
}
const ok = !!layout && errors.length === 0;
if (warnings.length) { origLog('\n── Warnings (data kept, look at these) ──'); for (const w of warnings) origLog(`• ${w}`); }
if (errors.length) { origLog('\n── ERRORS (result must not be used) ──'); for (const e of [...new Set(errors)]) origLog(`✗ ${e}`); }
origLog(`\n${ok ? 'RESULT: OK' : 'RESULT: FAILED'}`);

if (flags.json) {
  const out = {
    ok, parserVersion: PARSER_VERSION, pdfjsVersion: pdfjs.version, file: path.basename(file), sha256, layout: layout?.name || null,
    errors: [...new Set(errors)], warnings,
    header: result && Object.fromEntries(Object.entries(result.header).map(([k, v]) => [k, ['opening', 'debitTotal', 'creditTotal', 'closing'].includes(k) && v != null ? { cents: v, amount: dec(v) } : v])),
    totals: result?.totals || null,
    transactions: result?.tx || [],
    lines: lines.map(({ page, y, cells }) => ({ page, y: +y.toFixed(1), cells: cells.map((c) => ({ x: +c.x.toFixed(1), w: +c.w.toFixed(1), str: c.str })) })),
  };
  await writeFile(flags.json, JSON.stringify(out, null, 2), { flag: flags.force ? 'w' : 'wx' });
  origLog(`Wrote ${flags.json}${ok ? '' : ' (ok: false)'}`);
}
process.exit(!layout ? EXIT.UNKNOWN_LAYOUT : ok ? EXIT.OK : EXIT.CHECKS);
