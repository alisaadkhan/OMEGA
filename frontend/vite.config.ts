import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { headersFile } from './security-headers'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

/** Writes dist/_headers (audit SEC-14) for the Supabase project this build talks to. */
function securityHeadersFile(supabaseUrl: string | undefined) {
  return {
    name: 'mushin-security-headers',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL must be set to build the security headers')
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(supabaseUrl) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const apiPort = rootEnv.PORT || '4000'
  return {
    envDir: '..',
    plugins: [
      figmaAssetResolver(),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
      securityHeadersFile(rootEnv.VITE_SUPABASE_URL),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
        '@mushin/contracts': path.resolve(__dirname, '../packages/contracts/src/index.ts'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
          // The API scopes the staff refresh cookie to /admin/v1/auth; through this proxy the browser sees /api/admin/v1/auth.
          cookiePathRewrite: { '/admin/v1/auth': '/api/admin/v1/auth' },
        },
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
