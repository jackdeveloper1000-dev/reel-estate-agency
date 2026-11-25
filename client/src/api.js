// Sent with every API call – set VITE_API_KEY in client/.env (same value as API_KEY in server/.env)
const API_KEY = import.meta.env.VITE_API_KEY || '';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}), ...(API_KEY ? { 'x-api-key': API_KEY } : {}) };
  const res = await fetch(`/api${path}`, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('ra:logged-out'));
    throw err;
  }
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

export const api = {
  list: () => request('/projects'),
  get: (id) => request(`/projects/${id}`),
  createFromUrl: (url, settings, autoRender = true) => request('/projects', json('POST', { url, settings, autoRender })),
  createFromHtml: (html, url, settings, autoRender = false) => request('/projects/html', json('POST', { html, url, settings, autoRender })),
  importHtml: (id, html, url) => request(`/projects/${id}/html`, json('POST', { html, url })),
  createFromPhotos: (files, settings) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append('photos', f));
    fd.append('settings', JSON.stringify(settings || {}));
    return request('/projects/upload', { method: 'POST', body: fd });
  },
  addPhotos: (id, files) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append('photos', f));
    return request(`/projects/${id}/photos`, { method: 'POST', body: fd });
  },
  uploadMusic: (id, file) => {
    const fd = new FormData();
    fd.append('music', file);
    return request(`/projects/${id}/music`, { method: 'POST', body: fd });
  },
  update: (id, body) => request(`/projects/${id}`, json('PATCH', body)),
  duplicate: (id, body) => request(`/projects/${id}/duplicate`, json('POST', body)),
  purgeSources: (id) => request(`/projects/${id}/sources`, { method: 'DELETE' }),
  render: (id) => request(`/projects/${id}/render`, json('POST')),
  retry: (id) => request(`/projects/${id}/retry`, json('POST')),
  remove: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  // account
  me: () => request('/auth/me'),
  sendOtp: (phone, purpose, name, acceptedTerms = false) =>
    request('/auth/otp', json('POST', { phone, purpose, name, acceptedTerms })),
  verifyOtp: (phone, code) => request('/auth/verify', json('POST', { phone, code })),
  updateMe: (data) => request('/auth/me', json('PATCH', typeof data === 'string' ? { name: data } : data)),
  logout: () => request('/auth/logout', json('POST')),

  // payments
  price: () => request('/payments/price'),
  paymentSummary: () => request('/payments/summary'),
  payments: () => request('/payments'),
  createOrder: () => request('/payments/order', json('POST')),
  verifyPayment: (body) => request('/payments/verify', json('POST', body)),
};

export const BUSY = ['scraping', 'queued', 'rendering'];
