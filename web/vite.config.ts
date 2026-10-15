import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = process.env.VITE_API_PROXY ?? 'http://localhost:3810';

export default defineConfig({
  plugins: [react()],
  server: {
    // Unique UI port for this repo (avoids default Vite :5173)
    port: 5810,
    strictPort: true,
    proxy: {
      '/v1': {
        target: apiProxy,
        changeOrigin: true,
      },
      '/health': {
        target: apiProxy,
        changeOrigin: true,
      },
      '/docs': {
        target: apiProxy,
        changeOrigin: true,
      },
    },
  },
});
