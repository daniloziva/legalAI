# Bank statement PDF parser (probe, v3)

Parses UniCredit Bank Srbija daily statement PDFs ("STANJE I PROMENE SREDSTAVA") for any currency
(tested on RSD statement 061 and EUR statement 004119, both passing) and refuses any result it
cannot fully account for. This is the reference implementation for the app's bank-statement epic (F6).

## Install and run

```bash
cd scripts/statements
npm ci --omit=optional --ignore-scripts
node statement-probe.mjs izvod.pdf
node statement-probe.mjs izvod.pdf --json out.json   # refuses to overwrite; add --force
node statement-probe.mjs izvod.pdf --lines           # every text line with positions (new layouts)
```

Node 20+. `pdfjs-dist` is pinned to exactly 4.10.38 (not affected by CVE-2024-4367; eval is off).

Exit codes: 0 ok · 1 usage · 2 no text layer (scan) · 3 checks failed · 4 PDF unreadable · 5 layout unknown.

## What it does

- Upright text from rotated pages (UniCredit statements are landscape, /Rotate 270) via the
  viewport transform; drops the 3× overprinted "bold" copies (longest string first, containment).
- Lines and cells by position; columns found from the PROMENE table header words on every page.
- Header: statement no., date, account (Z.R. line, else from the IBAN), IBAN, currency (any ISO 4217
  code, from the "novo stanje" column header), STANJE values matched to their header by position.
- Records: one per 6-digit number; multi-line names, page continuation, totals row
  "(ukupno N naloga) Ukupno debit credit". Fields per transaction: no, side (debit/credit by column,
  sign must agree), amount (exact decimal string) + amountCents, bookingDate, paymentCode (šifra),
  kind (transfer / card / bank), counterparty, counterpartyAccount, purpose, referenceDebit,
  referenceCredit, referenceTruncated, bankTxId, bankOrderRef, card fields, details.
- Known bank quirk: references longer than 22 characters are cut by the bank; the 23rd character spills
  into the complaint column. The parser moves it back and flags `referenceTruncated` (never exact-match).
- Checks (any failure → exit 3, `ok:false` in JSON): opening − debits + credits = closing (header and
  lines), header totals = lines, counts = header, "(ukupno N naloga)" = N, numbering 000001…N with no
  gaps, one amount and one booking date per record (= statement date), footer statement number and page
  numbers, IBAN ↔ account, no unassigned or overlapping text, no rotated or off-page text, pdfjs
  warnings are fatal. On foreign-currency statements the "Ukupno" row is in RSD: both sides must imply
  one rate (UniCredit uses the NBS middle rate, confirmed for 07.04.2026: 117,3737).
- Account control digits (98 − first16·100 mod 97) and IBAN mod-97 are warnings, not errors.

Test PDFs are client data and are not in the repo.
