// `npm run build:server`: bundle the server entrypoints into dist-server/ (no node_modules needed at runtime).
// BUILD_SERVER_OUT overrides the output folder (the bundle test builds into a temp dir).
import { build } from 'esbuild'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.env.BUILD_SERVER_OUT || 'dist-server'
rmSync(out, { recursive: true, force: true })
await build({
  entryPoints: {
    main: 'server/main.ts',
    worker: 'server/worker/main.ts',
    migrate: 'server/db/migrate.ts',
    'worker-health': 'server/worker/health.ts',
    // `docker compose exec app node dist-server/gate-reset-pin.js` (the image has no tsx).
    'gate-reset-pin': 'server/gate/cli.ts',
  },
  outdir: out,
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
  logLevel: process.env.BUILD_SERVER_OUT ? 'warning' : 'info',
})

// Data read via import.meta.url at runtime (bundled chunks live directly in the output folder).
cpSync('server/curriculum/data', join(out, 'data'), { recursive: true })
// The runtime image installs exactly this native module version (see Dockerfile).
writeFileSync(join(out, 'sharp-version'), JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8')).version)

// Self-check: every `new URL('<relative>', import.meta.url)` in the bundle must resolve inside it.
// (Migrations are read from the working directory instead; the Dockerfile copies them.)
const missing = []
for (const f of readdirSync(out).filter((n) => n.endsWith('.js'))) {
  for (const m of readFileSync(join(out, f), 'utf8').matchAll(
    /new URL\(\s*["'`](\.[^"'`]*)["'`]\s*,\s*import\.meta\.url/g,
  ))
    if (!existsSync(join(out, m[1]))) missing.push(`${f}: ${m[1]}`)
}
if (missing.length) {
  console.error(`build-server: runtime files missing from ${out}:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
