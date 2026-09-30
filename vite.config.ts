import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const CSP = "default-src 'self'; connect-src 'self' https://api.github.com https://raw.githubusercontent.com; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'";

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'inject-csp',
      transformIndexHtml(html) {
        if (command !== 'build') return html;
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      },
    },
  ],
  worker: { format: 'es' },
}));
