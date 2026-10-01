// `npm run build` entry: generate speech first unless JACKAPP_SKIP_SPEECH=1, then tsc + vite.
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// uv's default install dirs are often missing from non-interactive shells (CI, Playwright's web server).
process.env.PATH = [process.env.PATH, join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin')].join(
  delimiter,
)

const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (process.env.JACKAPP_SKIP_SPEECH !== '1') run('npm run speech')
run('tsc -b && vite build')
