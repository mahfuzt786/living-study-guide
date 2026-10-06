// Thin client for api.php. Every request carries the session cookie; writes also carry the CSRF token.

const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(action, { method = 'GET', params = {}, body } = {}) {
  const url = new URL('api.php', location.href);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the study guide server. Is it still running?', 0, null);
  }
  if (res.status === 401) {
    location.href = 'login.php';
    throw new ApiError('Signed out.', 401, null);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status, data);
  return data;
}

export const get = (action, params) => api(action, { params });
export const post = (action, body) => api(action, { method: 'POST', body });
