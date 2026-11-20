#!/usr/bin/env node
// Seed a Minimax (RS) test organisation with fictional data mirroring the RSP demo story,
// or remove it again. Everything created is tagged so cleanup only touches seed data:
//   customers and items: Code starts with "TEST-"; invoices: Notes starts with "TEST-SEED:".
// Issued and received invoices are created as DRAFTS (Status "O"): no number is taken,
// nothing is issued, nothing goes to SEF. Customers are set to EInvoiceIssuing "SeNePripravlja".
//
// Usage:
//   node scripts/minimax-seed.mjs            # create what is missing (idempotent)
//   node scripts/minimax-seed.mjs --cleanup  # delete everything this script created
// Env: same as minimax-probe.mjs (MINIMAX_ID, MINIMAX_SECRET, MINIMAX_USERNAME, MINIMAX_PASSWORD,
//      optional MINIMAX_ORG_ID). Behind a proxy: NODE_USE_ENV_PROXY=1.

const AUTH_URL = 'https://moj.minimax.rs/RS/AUT/OAuth20/Token';
const API = 'https://moj.minimax.rs/RS/API/';
const env = (...n) => n.map((k) => process.env[k]).find((v) => v && v.trim())?.trim();
const cfg = {
  clientId: env('MINIMAX_ID', 'minimax_id'), clientSecret: env('MINIMAX_SECRET', 'minimax_secret'),
  username: env('MINIMAX_USERNAME', 'minimax_username'), password: env('MINIMAX_PASSWORD', 'minimax_password'),
  orgId: env('MINIMAX_ORG_ID', 'minimax_org_id'),
};
const CLEANUP = process.argv.includes('--cleanup');
const TAG = 'TEST-SEED:';

let token;
async function auth() {
  const res = await fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: cfg.clientId, client_secret: cfg.clientSecret, username: cfg.username, password: cfg.password, scope: 'minimax.rs' }) });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token: ${JSON.stringify(j)}`);
  token = j.access_token;
}
let calls = 0;
async function api(method, path, { query, body } = {}) {
  calls++;
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) { const e = new Error(`${method} ${url.pathname} → ${res.status}: ${text.slice(0, 800)}`); e.status = res.status; throw e; }
  if (!json && res.headers.get('location')) {
    const loc = new URL(res.headers.get('location'), API).pathname.replace(/^\/RS\/API\//, '');
    return api('GET', loc);
  }
  return json;
}
const rows = (j) => (Array.isArray(j) ? j : j?.Rows ?? []);
async function all(path) {
  const out = [];
  for (let p = 1; p < 50; p++) {
    const j = await api('GET', path, { query: { CurrentPage: p, PageSize: 100 } });
    out.push(...rows(j));
    if (rows(j).length < 100) break;
  }
  return out;
}

/** documents of a kind whose Notes carry the seed tag (lists omit Notes, so read each one) */
async function seeded(O, kind, idField) {
  const out = [];
  for (const x of await all(`${O}/${kind}`)) {
    const full = await api('GET', `${O}/${kind}/${x[idField]}`);
    if ((full.Notes ?? '').startsWith(TAG)) out.push(full);
  }
  return out;
}

// ---------- fictional data (mirrors the RSP demo) ----------
// PIBs are generated with a valid check digit from obviously fictional bases (99xxxxxx).
function pib(base8) {
  let r = 10;
  for (const ch of base8) { let s = (Number(ch) + r) % 10; if (s === 0) s = 10; r = (s * 2) % 11; }
  const c = (11 - r) % 10;
  return base8 + c;
}
const CLIENTS = [
  { code: 'TEST-ALFA', name: 'TEST Alfa Gradnja d.o.o.', country: 'RS', pib: pib('99451233'), mb: '99784512', address: 'Knez Mihailova 10', zip: '11000', city: 'Beograd' },
  { code: 'TEST-KOVAC', name: 'TEST Kovač Holding d.o.o.', country: 'RS', pib: pib('99331220'), mb: '99455019', address: 'Bulevar Mihajla Pupina 6', zip: '11070', city: 'Beograd' },
  { code: 'TEST-NORDWIND', name: 'TEST Nordwind GmbH', country: 'DE', countryName: 'Nemačka', vat: 'DE298441203', address: 'Am Sandtorkai 12', zip: '20457', city: 'Hamburg' },
  { code: 'TEST-BALKAN', name: 'TEST Balkan Retail Holding Kft.', country: 'HU', countryName: 'Mađarska', vat: 'HU24118090', address: 'Váci út 33', zip: '1134', city: 'Budapest' },
  { code: 'TEST-ADRIATIC', name: 'TEST Adriatic Logistics Sh.p.k.', country: 'AL', countryName: 'Albanija', vat: 'L91234567A', address: 'Rruga e Durrësit 44', zip: '1001', city: 'Tirana' },
];
const VENDORS = [
  { code: 'TEST-LINGUA', name: 'TEST Prevodilački biro Lingua', country: 'RS', pib: pib('99223471'), mb: '99812233', address: 'Kralja Milana 22', zip: '11000', city: 'Beograd' },
  { code: 'TEST-DHL', name: 'TEST DHL Express Srbija', country: 'RS', pib: pib('99000221'), mb: '99120044', address: 'Autoput 22', zip: '11080', city: 'Zemun' },
  { code: 'TEST-TAXI', name: 'TEST Taxi Beograd d.o.o.', country: 'RS', pib: pib('99889034'), mb: '99673390', address: 'Bulevar oslobođenja 3', zip: '11000', city: 'Beograd' },
  { code: 'TEST-BIRO', name: 'TEST Kancelarijski materijal Biro', country: 'RS', pib: pib('99541120'), mb: '99230871', address: 'Cara Dušana 81', zip: '11000', city: 'Beograd' },
];
const ITEMS = [
  { code: 'TEST-PU', name: 'TEST Pravne usluge', vat: 'S', price: 0 },
  { code: 'TEST-PU-INO', name: 'TEST Legal services (foreign client)', vat: 'O', price: 0 },
  { code: 'TEST-TR', name: 'TEST Prolazni troškovi (refakturisanje)', vat: 'N', price: 0 },
];
// Issued invoices, October 2026 month-end (drafts). Rows: [item code, text, amount EUR, VAT code]
const ISSUED = [
  { key: 'IR-360', customer: 'TEST-ALFA', ref: 'Arbitraža ICC', rows: [['TEST-PU', 'Pravne usluge — oktobar 2026', 1800, 'S'], ['TEST-TR', 'Administrativni troškovi ICC', 1900, 'N'], ['TEST-TR', 'Prevoz — septembar', 26.46, 'N']] },
  { key: 'IR-361', customer: 'TEST-ALFA', ref: 'Zakup poslovnog prostora', rows: [['TEST-PU', 'Pravne usluge — oktobar 2026', 2000, 'S']] },
  { key: 'IR-362', customer: 'TEST-NORDWIND', ref: 'Akvizicija Delta', due: '2026-11-15', rows: [['TEST-PU-INO', 'Legal services — October 2026', 1300, 'O'], ['TEST-TR', 'Local transport', 26.46, 'O']] },
  { key: 'IR-363', customer: 'TEST-KOVAC', ref: 'Kovač v. Delta', rows: [['TEST-PU', 'Pravne usluge — oktobar 2026', 1500, 'S'], ['TEST-TR', 'Sudska taksa P 1234/2026', 125.48, 'N']] },
  { key: 'IR-364', customer: 'TEST-BALKAN', ref: 'Spajanje HU', due: '2026-11-15', rows: [['TEST-PU-INO', 'Legal services — merger HU, October 2026', 2000, 'O'], ['TEST-TR', 'Registry fees', 40.97, 'O']] },
  { key: 'IR-365', customer: 'TEST-ADRIATIC', ref: 'Tirana — spor', rows: [['TEST-PU-INO', 'Legal services — October 2026', 1000, 'O'], ['TEST-TR', 'Local counsel, Tirana', 200, 'O'], ['TEST-TR', 'Courier — documents Tirana', 17.07, 'O']] },
];
// Received invoices (drafts): vendor, their number, date, amount, currency
const RECEIVED = [
  { key: 'UR-LINGUA', vendor: 'TEST-LINGUA', ref: '2026-131', date: '2026-11-04', amount: 365, currency: 'EUR', note: 'Prevodilačke usluge oktobar 2026 (3 naloga) — Kovač v. Delta' },
  { key: 'UR-DHL', vendor: 'TEST-DHL', ref: 'K-55201', date: '2026-11-05', amount: 9500, currency: 'RSD', note: 'Kurirske usluge — zbirna faktura' },
  { key: 'UR-TAXI', vendor: 'TEST-TAXI', ref: 'TX-1026', date: '2026-11-03', amount: 18600, currency: 'RSD', note: 'Taksi prevoz oktobar 2026' },
  { key: 'UR-BIRO', vendor: 'TEST-BIRO', ref: 'BR-2244', date: '2026-11-02', amount: 6800, currency: 'RSD', note: 'Kancelarijski materijal' },
];

// ---------- helpers ----------
const VAT_PCT = { S: 20, Z: 10, P: 8 };
const EUR_RSD = 117.15; // NBS middle rate used across the demo
const ref = {};
async function lookupRefs(O) {
  ref.eur = (await api('GET', `${O}/currencies/code(EUR)`)).CurrencyId;
  ref.rsd = (await api('GET', `${O}/currencies/code(RSD)`)).CurrencyId;
  ref.vat = Object.fromEntries(rows(await api('GET', `${O}/vatrates`, { query: { date: '2026-10-31' } })).map((v) => [v.Code, v.VatRateId]));
  ref.country = {};
  for (const c of ['RS', 'DE', 'HU', 'AL']) ref.country[c] = (await api('GET', `${O}/countries/code(${c})`)).CountryId;
  ref.template = rows(await api('GET', `${O}/report-templates`)).find((t) => (t.DisplayType ?? t.Type) === 'IR')?.ReportTemplateId;
}
async function byCode(O, kind, code) {
  try { return await api('GET', `${O}/${kind}/code(${encodeURIComponent(code)})`); } catch (e) { if (e.status === 404) return null; throw e; }
}
const log = (s) => console.log(s);

async function ensureCustomer(O, c, vendor) {
  const found = await byCode(O, 'customers', c.code);
  if (found?.CustomerId) { log(`  = ${c.name} (${found.CustomerId})`); return found; }
  const domestic = c.country === 'RS';
  const created = await api('POST', `${O}/customers`, { body: {
    Code: c.code, Name: c.name, Address: c.address, PostalCode: c.zip, City: c.city, Country: { ID: ref.country[c.country] }, CountryName: domestic ? undefined : c.countryName,
    TaxNumber: domestic ? c.pib : undefined, RegistrationNumber: domestic ? c.mb : undefined, VATIdentificationNumber: domestic ? undefined : c.vat,
    SubjectToVAT: 'D', Currency: { ID: domestic && vendor ? ref.rsd : ref.eur }, ExpirationDays: 30, Usage: 'D', EInvoiceIssuing: 'SeNePripravlja',
  } });
  const c2 = created?.CustomerId ? created : await byCode(O, 'customers', c.code);
  log(`  + ${c.name} (${c2?.CustomerId})`);
  return c2;
}
async function ensureItem(O, it) {
  const found = await byCode(O, 'items', it.code);
  if (found?.ItemId) { log(`  = ${it.name} (${found.ItemId})`); return found; }
  const created = await api('POST', `${O}/items`, { body: { Code: it.code, Name: it.name, ItemType: 'S', UnitOfMeasurement: 'kom', VatRate: { ID: ref.vat[it.vat] }, Price: it.price, Currency: { ID: ref.eur }, Usage: 'D' } });
  const i2 = created?.ItemId ? created : await byCode(O, 'items', it.code);
  log(`  + ${it.name} (${i2?.ItemId})`);
  return i2;
}

async function seed(O) {
  await lookupRefs(O);
  log(`refs: EUR ${ref.eur}, RSD ${ref.rsd}, VAT ${JSON.stringify(ref.vat)}, template ${ref.template}`);

  log('\nClients'); const cust = {};
  for (const c of CLIENTS) cust[c.code] = await ensureCustomer(O, c, false);
  log('Vendors');
  for (const v of VENDORS) cust[v.code] = await ensureCustomer(O, v, true);
  log('Items'); const items = {};
  for (const it of ITEMS) items[it.code] = await ensureItem(O, it);

  log('Issued invoices (drafts)');
  const existingIssued = await seeded(O, 'issuedinvoices', 'IssuedInvoiceId');
  for (const inv of ISSUED) {
    const note = `${TAG}${inv.key}`;
    const have = existingIssued.find((x) => (x.Notes ?? '').startsWith(note));
    if (have) { log(`  = ${inv.key} (${have.IssuedInvoiceId})`); continue; }
    const body = {
      Customer: { ID: cust[inv.customer].CustomerId }, DateIssued: '2026-10-31', DateTransaction: '2026-10-31', DateDue: inv.due ?? '2026-11-30',
      Currency: { ID: ref.eur }, Status: 'O', InvoiceType: 'R', PricesOnInvoice: 'N', DocumentReference: inv.ref, Notes: `${note} · demo data, safe to delete`,
      IssuedInvoiceReportTemplate: ref.template ? { ID: ref.template } : undefined,
      IssuedInvoiceRows: inv.rows.map(([code, text, amount, vat], i) => ({ RowNumber: i + 1, Item: { ID: items[code].ItemId }, ItemName: text, Quantity: 1, UnitOfMeasurement: 'kom', Price: amount, VatRate: { ID: ref.vat[vat] }, VATPercent: VAT_PCT[vat] ?? 0 })),
    };
    try {
      const created = await api('POST', `${O}/issuedinvoices`, { body });
      log(`  + ${inv.key} → ${cust[inv.customer].Name}${created?.IssuedInvoiceId ? ` (${created.IssuedInvoiceId})` : ''}`);
    } catch (e) { log(`  ✗ ${inv.key}: ${e.message}`); }
  }

  log('Received invoices (drafts)');
  const existingReceived = await seeded(O, 'receivedinvoices', 'ReceivedInvoiceId');
  for (const r of RECEIVED) {
    const note = `${TAG}${r.key}`;
    const have = existingReceived.find((x) => (x.Notes ?? '').startsWith(note));
    if (have) { log(`  = ${r.key} (${have.ReceivedInvoiceId})`); continue; }
    const body = {
      Customer: { ID: cust[r.vendor].CustomerId }, DocumentReference: r.ref, DateIssued: r.date, DateTransaction: r.date, DateReceived: r.date,
      DateDue: '2026-11-30', InvoiceAmount: r.amount, InvoiceAmountDomesticCurrency: r.currency === 'EUR' ? Math.round(r.amount * EUR_RSD * 100) / 100 : r.amount,
      Currency: { ID: r.currency === 'EUR' ? ref.eur : ref.rsd }, Status: 'O', PaymentType: 'N',
      Notes: `${note} · ${r.note} · demo data, safe to delete`,
    };
    try {
      const created = await api('POST', `${O}/receivedinvoices`, { body });
      log(`  + ${r.key} ${r.ref} ${r.amount} ${r.currency}${created?.ReceivedInvoiceId ? ` (${created.ReceivedInvoiceId})` : ''}`);
    } catch (e) { log(`  ✗ ${r.key}: ${e.message}`); }
  }
}

async function cleanup(O) {
  log('Issued invoices');
  for (const x of await seeded(O, 'issuedinvoices', 'IssuedInvoiceId')) {
    await api('DELETE', `${O}/issuedinvoices/${x.IssuedInvoiceId}`, { query: { rowVersion: x.RowVersion } }); log(`  - ${x.IssuedInvoiceId}`);
  }
  log('Received invoices');
  for (const x of await seeded(O, 'receivedinvoices', 'ReceivedInvoiceId')) {
    await api('DELETE', `${O}/receivedinvoices/${x.ReceivedInvoiceId}`, { query: { rowVersion: x.RowVersion } }); log(`  - ${x.ReceivedInvoiceId}`);
  }
  log('Items');
  for (const it of ITEMS) { const f = await byCode(O, 'items', it.code); if (f?.ItemId) { await api('DELETE', `${O}/items/${f.ItemId}`, { query: { rowVersion: f.RowVersion } }); log(`  - ${it.code}`); } }
  log('Customers');
  for (const c of [...CLIENTS, ...VENDORS]) { const f = await byCode(O, 'customers', c.code); if (f?.CustomerId) { await api('DELETE', `${O}/customers/${f.CustomerId}`, { query: { rowVersion: f.RowVersion } }); log(`  - ${c.code}`); } }
}

(async () => {
  const missing = ['clientId', 'clientSecret', 'username', 'password'].filter((k) => !cfg[k]);
  if (missing.length) { console.error(`Missing env: ${missing.join(', ')}`); process.exit(2); }
  await auth();
  const orgs = rows(await api('GET', 'api/currentuser/orgs'));
  const org = cfg.orgId ?? (orgs[0]?.Organisation ?? orgs[0])?.ID;
  log(`Organisation ${org} · ${CLEANUP ? 'CLEANUP' : 'SEED'}`);
  const O = `api/orgs/${org}`;
  await (CLEANUP ? cleanup(O) : seed(O));
  log(`\nDone · ${calls} API calls`);
})().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
