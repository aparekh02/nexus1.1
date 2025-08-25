import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    hmr: {
      clientPort: 443,
    },
    watch: {
      usePolling: true,
    },
    allowedHosts: [
      '5173-io6tlzfphybuqfsf5n6op-2e4bf3be.manusvm.computer',
      'localhost',
      '127.0.0.1'
    ]
  },
})


