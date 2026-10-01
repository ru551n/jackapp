// `npm run build` entry: generate speech first unless JACKAPP_SKIP_SPEECH=1, then tsc + vite.
import { spawnSync } from 'node:child_process'

const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (process.env.JACKAPP_SKIP_SPEECH !== '1') run('npm run speech')
run('tsc -b && vite build')
