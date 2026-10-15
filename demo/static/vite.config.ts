import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(root, '../../web');

/** GitHub Pages project site: /insurance-vertical/ — override with VITE_BASE=./ for relative. */
const base = process.env.VITE_BASE ?? '/insurance-vertical/';

export default defineConfig({
  base,
  plugins: [react()],
  publicDir: path.join(webRoot, 'public'),
  resolve: {
    alias: {
      // Reuse the live admin UI; demo only replaces the network with mock-api.
      '@web': path.join(webRoot, 'src'),
    },
  },
  server: {
    port: 5812,
    strictPort: true,
  },
  preview: {
    port: 5812,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
