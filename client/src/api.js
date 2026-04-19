import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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

    const poll = async () => {
      if (signal?.aborted || settled) return;
      try {
        const status = await pollBatch(batchId);
        if (settled) return;
        if (onProgress) onProgress(status);
        if (status.status === 'complete') return settle(resolve, status.results);
        timerId = setTimeout(poll, POLL_INTERVAL);
      } catch (err) {
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
