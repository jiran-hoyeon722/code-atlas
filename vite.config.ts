import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'";

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
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        battle: fileURLToPath(new URL('./battle.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
}));
