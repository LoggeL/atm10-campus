export async function api(path, opts = {}) {
  const headers = { 'x-campus-csrf': '1', ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const read = !opts.method || opts.method === 'GET';
  const response = await fetch(path, {
    ...opts,
    cache: opts.cache ?? 'no-store',
    headers,
    body,
    signal: opts.signal ?? (read ? AbortSignal.timeout(20000) : undefined),
  });
  if (response.status === 401) {
    location.assign('/login');
    throw Error('Anmeldung abgelaufen.');
  }
  const result = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) {
    const error = Error(result?.error || response.statusText || 'HTTP ' + response.status);
    error.data = result;
    error.status = response.status;
    throw error;
  }
  return result;
}

export function linkStation(site) {
  if (!/^K(0[1-9]|[12][0-9]|3[0-7])$/.test(site)) return;
  const nav = document.querySelector('.campus-nav');
  if (!nav) return;
  nav.querySelector('[data-section="dashboard"]').href = '/erebor/dashboard?kanone=' + site;
  if (location.pathname !== '/app') {
    for (const key of ['overview', 'cannons'])
      nav.querySelector('[data-tab="' + key + '"]').href = '/app?project=erebor&kanone=' + site + '#' + key;
  }
}
