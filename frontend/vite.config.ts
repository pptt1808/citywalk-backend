import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    // Dev proxy: forward /api to backend. In production, Nginx handles this.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
})
