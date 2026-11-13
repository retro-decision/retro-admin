import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages is served from /retro-admin/. Dev uses the site root.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/retro-admin/' : '/',
}))
