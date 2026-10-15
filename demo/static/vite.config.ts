import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(root, '../../web');

/** GitHub Pages project site: /insurance-vertical/ — override with VITE_BASE=./ for relative. */
const base = process.env.VITE_BASE ?? '/insurance-vertical/';

const nm = path.join(root, 'node_modules');

export default defineConfig({
  base,
  plugins: [react()],
  publicDir: path.join(webRoot, 'public'),
  resolve: {
    // web/src lives outside this package root — pin deps so CI/rolldown resolve them.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@web': path.join(webRoot, 'src'),
      react: path.join(nm, 'react'),
      'react-dom': path.join(nm, 'react-dom'),
      'react/jsx-runtime': path.join(nm, 'react/jsx-runtime'),
      'react/jsx-dev-runtime': path.join(nm, 'react/jsx-dev-runtime'),
      d3: path.join(nm, 'd3'),
      mermaid: path.join(nm, 'mermaid'),
      '@dagrejs/dagre': path.join(nm, '@dagrejs/dagre'),
    },
  },
  server: {
    port: 5812,
    strictPort: true,
    fs: { allow: [root, webRoot] },
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
