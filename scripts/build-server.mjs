// `npm run build:server`: bundle the server entrypoints into dist-server/ (no node_modules needed at runtime).
import { build } from 'esbuild'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

rmSync('dist-server', { recursive: true, force: true })
await build({
  entryPoints: {
    main: 'server/main.ts',
    worker: 'server/worker/main.ts',
    migrate: 'server/db/migrate.ts',
    'worker-health': 'server/worker/health.ts',
  },
  outdir: 'dist-server',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // Test-only (createTestDb) and optional native modules. sharp (native, worker only) must be
  // present in the runtime image's node_modules; see docs/platform/uploads.md.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-kit', 'drizzle-kit/api', 'pg-native', 'sharp'],
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})

// Data read via import.meta.url at runtime (bundled chunks live directly in dist-server/).
cpSync('server/curriculum/data', 'dist-server/data', { recursive: true })
// The runtime image installs exactly this native module version (see Dockerfile).
writeFileSync('dist-server/sharp-version', JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8')).version)
