import { rmSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The build goes straight into ../docs, which FastAPI serves locally and GitHub Pages serves
// online. emptyOutDir is off so docs/driver.html, docs/classic.html, config.js, auth.js,
// style.css and vendor/ stay; only our own docs/assets folder is replaced on each build.
const outDir = fileURLToPath(new URL('../docs', import.meta.url))
const assetsDir = fileURLToPath(new URL('../docs/assets', import.meta.url))

function cleanOldAssets(): Plugin {
  return {
    name: 'fleetmind-clean-assets',
    apply: 'build',
    buildStart() { rmSync(assetsDir, { recursive: true, force: true }) },
  }
}

export default defineConfig({
  base: './',                    // works at / (FastAPI) and at /fleetmind/ (GitHub Pages)
  plugins: [react(), tailwindcss(), cleanOldAssets()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir,
    emptyOutDir: false,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1600,  // maplibre-gl is about 1 MB on its own
    rollupOptions: {
      // index.html = dashboard, driver-app.html = the new driver phone page (docs/driver.html stays
      // as it is until the new one has been tried on a phone)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        driver: fileURLToPath(new URL('./driver-app.html', import.meta.url)),
      },
      output: { manualChunks: id => (id.includes('maplibre-gl') ? 'maplibre' : undefined) },
    },
  },
  server: {
    // npm --prefix frontend run dev: the API runs on uvicorn at :8000
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
