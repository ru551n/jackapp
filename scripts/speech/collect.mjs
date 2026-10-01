// Writes .speech/phrases.json: every utterance the app can speak (see docs/audio.md).
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const { module } = await runnerImport(fileURLToPath(new URL('./phrases.ts', import.meta.url)), {
  configFile: false,
  server: { watch: null },
})
const t0 = Date.now()
const phrases = module.collectUtterances()
mkdirSync('.speech', { recursive: true })
writeFileSync('.speech/phrases.json', JSON.stringify(phrases, null, 1))
const count = (lang) => phrases.filter((p) => p.lang === lang).length
console.log(`speech: ${phrases.length} phrases (sv ${count('sv')}, en ${count('en')}) in ${Date.now() - t0} ms`)
