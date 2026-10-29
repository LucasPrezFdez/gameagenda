import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
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

export default defineConfig({
  plugins: [react()],
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
  // La puerta de tamaño lee el JS inicial de `.vite/manifest.json` (ver §12.4).
  build: { manifest: true },
});
