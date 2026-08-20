import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_TRANSIENT_POLL_FAILURES = 3;

/**
 * Polls are exempt from rate limiting, so a poll failure is either
 * 401 (bad/cleared token — fatal, the gate handles it), 404 (job
 * TTL/safety-expired — fatal), or a network/5xx blip worth retrying.
 */
export function isTransientError(err) {
  return !err.response || err.response.status >= 500;
}

/* ========================================
   Auth token
   Stored in sessionStorage (deliberate: survives reload,
   dies with the tab — the app handles sensitive data,
   so localStorage is out).
   ======================================== */

const TOKEN_KEY = 'legalai_token';
const authListeners = new Set();

function notifyAuthChange(hasToken) {
  authListeners.forEach(fn => fn(hasToken));
}

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage unavailable (privacy mode) — nothing to persist
  }
  notifyAuthChange(true);
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  notifyAuthChange(false);
}

/**
 * Subscribe to auth state changes (token set / cleared).
 * Returns an unsubscribe function.
 */
export function onAuthChange(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

// Attach the token to every API request when present.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, drop the stored token — the app falls back to the token gate.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken();
    }
    return Promise.reject(err);
  }
);

/**
 * Verify a candidate token before storing it.
 *
 * /api/health is unauthenticated, so it cannot prove a token works. Instead
 * we GET a nonexistent batch id on an authorized route:
 *   401 -> token rejected by the auth middleware,
 *   404 (or any other response) -> the middleware accepted the token.
 * Uses bare axios so the interceptors (stored token, 401 handling) stay out
 * of the way.
 */
export async function verifyToken(token) {
  try {
    await axios.get('/api/extract/00000000-0000-0000-0000-000000000000', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return true;
  } catch (err) {
    if (err.response) return err.response.status !== 401;
    throw err; // network failure — caller decides what to show
  }
}

/**
 * Map an API error to a user-facing (Serbian) message.
 * Handles 429 (rate limit / SERVER_BUSY) and 401 explicitly.
 */
export function getErrorMessage(err, fallback) {
  const status = err.response?.status;
  if (status === 429) {
    // With responseType 'blob' the body is a Blob and code is unreadable —
    // the generic rate-limit message covers that case.
    const code = err.response?.data?.error?.code;
    if (code === 'SERVER_BUSY') {
      return 'Server je zauzet obradom drugih dokumenata. Pokušajte ponovo za nekoliko minuta.';
    }
    return 'Previše zahteva u kratkom periodu. Sačekajte nekoliko minuta i pokušajte ponovo.';
  }
  if (status === 401) {
    return 'Pristupni token nije važeći. Unesite ga ponovo.';
  }
  // Prefer the server's message, then the Serbian fallback; axios's English
  // err.message is the last resort (e.g. no fallback given).
  return err.response?.data?.error?.message || fallback || err.message;
}

/**
 * Submit files for extraction. Returns { batchId, fileCount, status }.
 */
export async function submitBatch(files, { signal } = {}) {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const { data } = await api.post('/extract', form, { signal });
  return data;
}

/**
 * Poll for batch progress. Returns { batchId, status, total, completed, results }.
 */
export async function pollBatch(batchId) {
  const { data } = await api.get(`/extract/${batchId}`);
  return data;
}

/**
 * Submit files and poll until complete.
 * Calls onProgress with each poll response.
 * Supports AbortController signal for cancellation.
 */
export async function extractDocuments(files, { onProgress, signal } = {}) {
  const batch = await submitBatch(files, { signal });
  const batchId = batch.batchId;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timerId = null;
    let timeoutId = null;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timerId) clearTimeout(timerId);
      if (timeoutId) clearTimeout(timeoutId);
      fn(value);
    };

    // 5-minute timeout
    timeoutId = setTimeout(() => {
      settle(reject, new Error('Obrada traje predugo. Pokušajte sa manje fajlova.'));
    }, POLL_TIMEOUT);

    if (signal) {
      signal.addEventListener('abort', () => settle(reject, new Error('Cancelled')), { once: true });
    }

    let transientFailures = 0;

    const poll = async () => {
      if (signal?.aborted || settled) return;
      try {
        const status = await pollBatch(batchId);
        if (settled) return;
        transientFailures = 0;
        if (onProgress) onProgress(status);
        if (status.status === 'complete') return settle(resolve, status.results);
        timerId = setTimeout(poll, POLL_INTERVAL);
      } catch (err) {
        // Tolerate a few consecutive network/5xx blips with a short backoff;
        // 401/404 are fatal immediately. The 5-min timeout still bounds us.
        if (isTransientError(err) && transientFailures < MAX_TRANSIENT_POLL_FAILURES) {
          transientFailures++;
          timerId = setTimeout(poll, POLL_INTERVAL * (transientFailures + 1));
          return;
        }
        settle(reject, err);
      }
    };
    poll();
  });
}

/**
 * Export results to Excel. Returns Blob.
 */
export async function downloadExcel(results) {
  const { data } = await api.post('/export', { results }, {
    responseType: 'blob',
  });
  return data;
}
