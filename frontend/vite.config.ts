import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@zama-fhe/relayer-sdk']
  },
  build: {
    target: 'esnext'
  },
  worker: {
    format: 'es'
  }
})
