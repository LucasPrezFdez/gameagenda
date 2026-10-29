import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Solo la interfaz local: evita el aviso del cortafuegos de Windows (ver §13.3).
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  // `es` y no `iife`: el Worker de búsqueda necesita chunks diferidos (ver §6.2).
  worker: { format: 'es' },
  // La puerta de tamaño lee el JS inicial de `.vite/manifest.json` (ver §12.4).
  build: { manifest: true },
});
