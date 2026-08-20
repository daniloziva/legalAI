# Environment variables — new keys

Documented here because this container cannot touch `.env*` files. The operator
adds these to `server/.env.example`, local `.env`, and the Railway service.

## APP_TOKEN (new, required)

- **Purpose:** shared static bearer token protecting every `/api/*` route except
  `GET /api/health`. Clients must send `Authorization: Bearer <APP_TOKEN>`.
- **Validation:** `z.string().min(16)` in `server/src/config/env.js` — the server
  refuses to boot without it.
- **Example placeholder:** `APP_TOKEN=change-me-to-a-long-random-string`
- **Generation suggestion:** `openssl rand -hex 32` (do not commit the real value).

## Dependency audit — 2026-08-20

Both lockfiles were audited against the npm advisory database (all transitive deps included)
and patched. Fixed: axios 1.15.0→1.18.0 and multer 2.1.1→2.2.0 (direct, `package.json` floors
raised), body-parser→1.20.6, brace-expansion→1.1.18/2.1.4, form-data→4.0.6, tmp→0.2.7,
qs→6.15.2 (nested under body-parser), hasown→2.0.4, nanoid→3.3.18, postcss→8.5.26.

Accepted (documented, not fixed):
- `qs` 6.14.2 (express pins ~6.14.0; the bug is in `qs.stringify`, express only parses queries)
- `uuid` 8.3.2 (exceljs; bug affects v3/v5/v6-with-buffer calls, exceljs uses v4)
- `vite` / `@babel/core` advisories (client devDependencies; never in the shipped bundle,
  vite issues are Windows-dev-server-specific)

Re-audit at deploy time: `npm audit --omit=dev` in `server/` (and occasionally `client/`).
The lockfiles are authoritative for Railway (`npm install` at build); the local
`node_modules` in this container are pnpm-managed test installs and may drift from the lock.
