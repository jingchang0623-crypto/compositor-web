import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE is the path the site is served under: "/" locally, "/<repo>/" on GitHub Pages (set by the deploy workflow).
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [react()],
  server: { port: 5173 },
})
