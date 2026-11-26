import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { headersFile } from './security-headers'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

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

/**
 * The staff portal lives at /_omega_ (owner, 22 Nov). The host serves files, not app routes, so the built page is also
 * written to dist/_omega_/index.html; the app reads the path and opens the staff portal.
 */
function staffPortalPage() {
  let outDir = 'dist'
  return {
    name: 'mushin-staff-portal-page',
    apply: 'build' as const,
    configResolved(c: { build: { outDir: string }; root: string }) {
      outDir = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      mkdirSync(path.join(outDir, '_omega_'), { recursive: true })
      writeFileSync(path.join(outDir, '_omega_', 'index.html'), readFileSync(path.join(outDir, 'index.html')))
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
      staffPortalPage(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
        '@mushin/contracts': path.resolve(__dirname, '../packages/contracts/src/index.ts'),
      },
      // The contracts live outside this folder; their zod (and React everywhere) must come from this app's own install,
      // so the build works when only frontend/ is installed (a Vercel service) and the bundle holds one copy of each.
      dedupe: ['zod', 'react', 'react-dom'],
    },
    server: {
      // Browser test runs (scripts/e2e/run-suite.sh sets MUSHIN_E2E_FROZEN=1): no hot reload and no file watching, so an
      // edit saved in the repository mid-run can't swap modules under the running app (a second React context copy
      // was reported as "useAuth must be used within AuthProvider", 25 Nov).
      ...(process.env.MUSHIN_E2E_FROZEN === '1' ? { hmr: false, watch: null } : {}),
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
