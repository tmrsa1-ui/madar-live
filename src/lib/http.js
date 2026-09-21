// fetch helpers with timeout, typed errors and optional fallback URLs.

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export async function fetchWithTimeout(url, { timeout = 15000, signal, ...init } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readBody(res) {
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) return res.json().catch(() => null);
  return res.text().catch(() => null);
}

export async function getJSON(url, options) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new HttpError(res.status, await readBody(res), url);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new HttpError(res.status, 'not json', url); // e.g. SPA fallback HTML
  return res.json();
}

export async function getText(url, options) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new HttpError(res.status, await readBody(res), url);
  return res.text();
}

/** Try each URL in order; resolve with the first success. */
export async function firstOk(urls, loader, options) {
  let lastErr;
  for (const url of urls) {
    try {
      return await loader(url, options);
    } catch (err) {
      lastErr = err;
      if (err?.status === 429) throw err; // rate limit: don't hammer the fallbacks
    }
  }
  throw lastErr || new Error('all sources failed');
}
