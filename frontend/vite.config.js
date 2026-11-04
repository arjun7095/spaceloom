import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY || 'http://localhost:5080';
const proxy = {
  '/api': { target: API, changeOrigin: true },
  '/uploads': { target: API, changeOrigin: true },
  '/socket.io': { target: API, ws: true, changeOrigin: true },
};

export default defineConfig({
  plugins: [
    react(),
    // Installable app with offline support (active in production builds: npm run build && npm run preview).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png'],
      manifest: {
        name: 'PrimeSpace IPFM',
        short_name: 'PrimeSpace',
        description: 'Integrated property and facility management',
        start_url: '/',
        display: 'standalone',
        background_color: '#F5F6FA',
        theme_color: '#FFFFFF',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/, /^\/socket\.io/],
        importScripts: ['/push-sw.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Today's jobs, checklists, tickets and attendance stay readable without signal.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/auth') && !url.pathname.startsWith('/api/v1/uploads'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: { cacheName: 'api', networkTimeoutSeconds: 6, expiration: { maxEntries: 500, maxAgeSeconds: 3 * 86400 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: { cacheName: 'files', matchOptions: { ignoreSearch: true }, expiration: { maxEntries: 300, maxAgeSeconds: 7 * 86400 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // Only the font subsets the browser actually uses are downloaded, then kept for offline use.
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 86400 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 200, maxAgeSeconds: 30 * 86400 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { chunkSizeWarningLimit: 2000 },
});
