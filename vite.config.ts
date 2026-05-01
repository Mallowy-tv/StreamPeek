import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        previewFrame: resolve(__dirname, 'preview-frame.html'),
      },
    },
  },
  plugins: [react(), crx({ manifest })],
})
