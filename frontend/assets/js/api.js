let csrfToken = '';

async function refreshCsrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const payload = await response.json();
  csrfToken = payload.csrfToken;
  return csrfToken;
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await refreshCsrf();
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`/api${path}`, { ...options, method, headers, body, credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const error = contentType.includes('application/json') ? await response.json() : { error: 'The request could not be completed.' };
    if (response.status === 403 && /session token/i.test(error.error || '')) { csrfToken = ''; }
    throw new Error(error.error || 'The request could not be completed.');
  }
  if (response.status === 204) return {};
  return contentType.includes('application/json') ? response.json() : response;
}

export async function download(path, filename) {
  const response = await api(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
