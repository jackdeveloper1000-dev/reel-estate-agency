import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Show a readable message instead of a blank 500 when the API isn't running
function explain(proxy) {
  proxy.on('error', (_err, _req, res) => {
    if (res.headersSent) return;
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API server is not running on port 5000. Run "npm run dev" from the project root and check the [api] logs.' }));
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', configure: explain },
      '/media': { target: 'http://127.0.0.1:5000' },
    },
  },
});
