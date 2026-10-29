import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { catalogDevPlugin } from './catalog-dev-plugin.ts';
import pkg from './package.json' with { type: 'json' };

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

// CSP de `ga-web` (ver §11.3) en `vite preview`, para que los E2E fallen ante una violación.
// Sin `upgrade-insecure-requests`: la vista previa local va por HTTP.
const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://shared.akamai.steamstatic.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    catalogDevPlugin(repoRoot),
    VitePWA({
      // Service Worker propio con la precaché del *build*, registrado desde la app (ver §6.1).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Sin `import` en el Service Worker: así vale también donde no hay módulos en SW.
        rollupFormat: 'iife',
      },
      manifest: {
        id: '/',
        name: 'GameAgenda',
        short_name: 'GameAgenda',
        description:
          'Tu agenda de videojuegos: apunta en segundos los juegos que quieres jugar y lleva su estado.',
        lang: 'es-ES',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#c2185b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          {
            name: 'Apuntar juego',
            short_name: 'Apuntar',
            url: '/apuntar',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_SHA__: JSON.stringify(gitSha()),
  },
  // Solo la interfaz local: evita el aviso del cortafuegos de Windows (ver §13.3).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: { 'Content-Security-Policy': PREVIEW_CSP },
  },
  // `es` y no `iife`: el Worker de búsqueda necesita chunks diferidos (ver §6.2).
  worker: { format: 'es' },
  // La puerta de tamaño lee el JS inicial de `.vite/manifest.json` (ver §12.4). El *build* del
  // modo `e2e` (§12.3) lleva los ganchos de prueba y va aparte, para no pisar el de producción.
  build: { manifest: true, outDir: mode === 'e2e' ? 'dist-e2e' : 'dist' },
}));
