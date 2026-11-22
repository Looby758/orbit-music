import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from GitHub Pages at /orbit-music/ (relative paths work there and anywhere else).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets' },
  test: { environment: 'node' }
} as never)
