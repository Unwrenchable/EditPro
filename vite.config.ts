import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { buildContentSecurityPolicy } from './electron/security.ts'

/** Production builds embed the strict CSP. Dev relies on the Electron session header so Vite HMR still runs. */
function productionContentSecurityPolicy(): Plugin {
  return {
    name: 'editpro-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: buildContentSecurityPolicy({ isDev: false, devPort: '5173', delivery: 'meta' }),
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), productionContentSecurityPolicy()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
} as Parameters<typeof defineConfig>[0])
