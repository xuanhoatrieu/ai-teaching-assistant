import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // SSE requires these settings to prevent buffering
        configure: (proxy, _options) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            // Check if this is an SSE response
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              // Disable response buffering for SSE
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
            }
          });
        },
      },
      // Proxy /files to backend for serving static files (audio, images)
      '/files': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
