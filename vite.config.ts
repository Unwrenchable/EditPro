import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContentSecurityPolicy, buildWebContentSecurityPolicy } from './electron/security.ts'
import { webInstallHeadTags } from './src/pwa/installMeta.ts'

const root = path.dirname(fileURLToPath(import.meta.url))
const webTarget = process.env.EDITPRO_TARGET === 'web'
/** Desktop production bundles omit the wasm engines. Dev, tests, and build:web keep them. */
const stubEngines = process.env.NODE_ENV === 'production' && !webTarget

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
            content: webTarget
              ? buildWebContentSecurityPolicy()
              : buildContentSecurityPolicy({ isDev: false, devPort: '5173', delivery: 'meta' }),
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: webTarget ? '/' : './',
  resolve: stubEngines
    ? {
        alias: {
          '@ffmpeg/ffmpeg': path.resolve(root, 'src/platform/web/stubs/ffmpeg.ts'),
          '@ffmpeg/util': path.resolve(root, 'src/platform/web/stubs/ffmpegUtil.ts'),
          '@huggingface/transformers': path.resolve(root, 'src/platform/web/stubs/transformers.ts'),
        },
      }
    : undefined,
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@ffmpeg/ffmpeg', 'onnxruntime-node', 'onnxruntime-web'],
  },
  build: webTarget
    ? {
        rollupOptions: {
          input: {
            main: path.resolve(root, 'index.html'),
            download: path.resolve(root, 'download.html'),
          },
        },
      }
    : undefined,
  plugins: [
    react(),
    productionContentSecurityPolicy(),
    {
      name: 'editpro-desktop-viewport',
      apply: 'build',
      transformIndexHtml(html) {
        if (webTarget) return html
        return html.replace(/\n?\s*<meta name="viewport"[^>]*>/, '')
      },
    },
    {
      name: 'editpro-web-install-meta',
      transformIndexHtml() {
        return webInstallHeadTags(webTarget)
      },
    },
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-electron/**', 'release/**'],
  },
} as Parameters<typeof defineConfig>[0])
