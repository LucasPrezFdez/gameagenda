import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
const entry = process.env.ENTRY || 'full'
export default defineConfig({ plugins: [react()], build: { outDir: 'dist-' + entry, rollupOptions: { input: entry + '.html' } } })
