import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current directory.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      nodePolyfills({
        globals: {
          Buffer: true,
          global: true,
          process: true
        },
        protocolImports: true,
        include: ['buffer', 'process', 'util', 'stream', 'crypto', 'zlib']
      }),
      visualizer({
        filename: 'dist/stats.html'
      })
    ],
    define: {
      'process.env': Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, JSON.stringify(value)])
      ),
      'global': 'globalThis',
      'window.global': 'globalThis'
    },
    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsDir: 'assets',
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom', 'react/jsx-runtime', 'algosdk', '@perawallet/connect', '@blockshake/defly-connect', '@txnlab/use-wallet', '@txnlab/use-wallet-react']
          }
        }
      }
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis'
        }
      }
    }
  }
})
