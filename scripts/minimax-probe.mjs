#!/usr/bin/env node
// Minimax (RS) API probe: authenticate, read, and optionally insert + clean up.
//
// Usage:
//   node scripts/minimax-probe.mjs            # read-only: token, orgs, currencies, customers
//   node scripts/minimax-probe.mjs --write    # also insert a test customer, read it back, delete it
//
// Env (credentials are read from the environment only, never from files):
//   MINIMAX_ID, MINIMAX_SECRET        OAuth client id / secret (lowercase minimax_id / minimax_secret also accepted)
//   MINIMAX_USERNAME, MINIMAX_PASSWORD  Minimax user the API acts as
//   MINIMAX_ORG_ID                    optional; defaults to the first organisation of the user
//   MINIMAX_SCOPE                     optional; defaults to "minimax.rs"
//
// Behind an HTTPS proxy (e.g. cloud sessions), run with NODE_USE_ENV_PROXY=1 (Node ≥ 22.21 / 24.5).
//
// Endpoints per https://moj.minimax.rs/RS/API/ (module pages Currency, Customer, User, Country).
// Rate limit there: 1,000 calls / org / rolling 24h. This probe uses ~6 (read) or ~10 (write).

const AUTH_URL = 'https://moj.minimax.rs/RS/AUT/OAuth20/Token';
const API = 'https://moj.minimax.rs/RS/API/';

const env = (...names) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();
const cfg = {
  clientId: env('MINIMAX_ID', 'minimax_id', 'MINIMAX_CLIENT_ID'),
  clientSecret: env('MINIMAX_SECRET', 'minimax_secret', 'MINIMAX_CLIENT_SECRET'),
  username: env('MINIMAX_USERNAME', 'minimax_username', 'MINIMAX_USER'),
  password: env('MINIMAX_PASSWORD', 'minimax_password', 'MINIMAX_PASS'),
  orgId: env('MINIMAX_ORG_ID', 'minimax_org_id'),
  scope: env('MINIMAX_SCOPE') ?? 'minimax.rs',
};
const WRITE = process.argv.includes('--write');

const missing = ['clientId', 'clientSecret', 'username', 'password'].filter((k) => !cfg[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}. See the header of this file.`);
  process.exit(2);
}

const step = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    username: cfg.username,
    password: cfg.password,
    scope: cfg.scope,
  });
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`token response has no access_token: ${text.slice(0, 400)}`);
  return json;
}

let token;
async function api(method, path, { query, body } = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(`${method} ${url.pathname}${url.search} → ${res.status}: ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, json, location: res.headers.get('location') };
}

const rowsOf = (j) => (Array.isArray(j) ? j : j?.Rows ?? []);

async function main() {
  step('Token (OAuth2 password grant)');
  const t = await getToken();
  token = t.access_token;
  ok(`access_token received, type ${t.token_type ?? '?'}, expires_in ${t.expires_in ?? '?'}s`);

  step('Organisations of the current user');
  const orgs = rowsOf((await api('GET', 'api/currentuser/orgs', { query: { PageSize: 50 } })).json);
  for (const o of orgs) {
    const org = o.Organisation ?? o;
    console.log(`  - ${org.ID ?? org.OrganisationId}  ${org.Name ?? ''}`);
  }
  const first = orgs[0]?.Organisation ?? orgs[0];
  const orgId = cfg.orgId ?? first?.ID ?? first?.OrganisationId;
  if (!orgId) throw new Error('no organisation available for this user');
  ok(`using organisation ${orgId}${cfg.orgId ? ' (from MINIMAX_ORG_ID)' : ' (first in list)'}`);
  const O = `api/orgs/${orgId}`;

  step('Currencies');
  const currencies = rowsOf((await api('GET', `${O}/currencies`)).json);
  ok(`${currencies.length} currencies: ${currencies.slice(0, 8).map((c) => c.Code).join(', ')}${currencies.length > 8 ? ', …' : ''}`);
  const eur = (await api('GET', `${O}/currencies/code(EUR)`)).json;
  ok(`EUR by code → CurrencyId ${eur?.CurrencyId}, ${eur?.Name}`);

  step('Customers (first page)');
  const cust = (await api('GET', `${O}/customers`, { query: { CurrentPage: 1, PageSize: 5 } })).json;
  ok(`total ${cust?.TotalRows ?? '?'}; first ${rowsOf(cust).length}:`);
  for (const c of rowsOf(cust)) console.log(`  - ${c.CustomerId}  ${c.Code}  ${c.Name}  PIB ${c.TaxNumber ?? '-'}`);

  if (!WRITE) {
    console.log('\nRead-only probe done. Re-run with --write to test insert (creates and deletes a test customer).');
    return;
  }

  step('Insert test customer');
  const country = (await api('GET', `${O}/countries/code(RS)`)).json;
  const code = `PROBE${Date.now().toString().slice(-8)}`;
  const created = await api('POST', `${O}/customers`, {
    body: {
      Code: code,
      Name: `API PROBE ${code} – obrisati`,
      Address: 'Test 1',
      PostalCode: '11000',
      City: 'Beograd',
      Country: { ID: country?.CountryId ?? country?.ID },
      SubjectToVAT: 'N',
      Currency: { ID: eur?.CurrencyId },
      Usage: 'D',
    },
  });
  let customer = created.json;
  if (!customer?.CustomerId && created.location) {
    customer = (await api('GET', new URL(created.location).pathname.replace(/^\/RS\/API\//, ''))).json;
  }
  if (!customer?.CustomerId) throw new Error(`insert returned ${created.status} but no customer: ${JSON.stringify(created.json)}`);
  ok(`created ${customer.CustomerId} (${customer.Code}), status ${created.status}`);

  step('Read it back');
  const back = (await api('GET', `${O}/customers/${customer.CustomerId}`)).json;
  ok(`${back.Name}, ${back.City}, country ${back.Country?.Name ?? back.CountryName}, currency ${back.Currency?.Name}`);

  step('Delete it');
  try {
    await api('DELETE', `${O}/customers/${customer.CustomerId}`, { query: { rowVersion: back.RowVersion } });
    ok('deleted');
  } catch (e) {
    console.error(`  ✗ delete failed, remove "${back.Name}" by hand in Minimax: ${e.message}`);
    process.exitCode = 1;
  }

  console.log('\nRead + write probe done.');
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
