async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, options);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
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
  render: (id) => request(`/projects/${id}/render`, json('POST')),
  retry: (id) => request(`/projects/${id}/retry`, json('POST')),
  remove: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
};

export const BUSY = ['scraping', 'queued', 'rendering'];
