import { expect, test } from '@playwright/test'

// Needs the voice models in public/voices (see docs/audio.md); the first run downloads nothing external.
test.skip(({ browserName }) => browserName !== 'chromium')
test.setTimeout(240_000)

test('in-browser Piper speaks sv and en with no external requests', async ({ page }) => {
  const external: string[] = []
  const origin = new URL('http://localhost:4173').origin
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) external.push(r.url())
  })
  await page.goto('./?speechtest')
  await page.waitForFunction(() => '__jackappSpeech' in globalThis)

  for (const [text, lang, minSec, maxSec] of [
    ['Tre vagnar står på stationen.', 'sv', 1, 6],
    ['Tap the blue train.', 'en', 0.7, 5],
    ['Tre vagnar står på stationen!', 'sv', 1, 6], // model already loaded: pure synthesis time
    ['Tap the blue train!', 'en', 0.7, 5],
  ] as const) {
    const r = await page.evaluate(
      async ([t, l]) => {
        const s = (
          globalThis as unknown as { __jackappSpeech: { synthesize: (t: string, l: string) => Promise<Blob> } }
        ).__jackappSpeech
        const t0 = performance.now()
        const b = await s.synthesize(t, l)
        const ms = performance.now() - t0
        const v = new DataView(await b.arrayBuffer())
        const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))
        return { ms, tag, size: b.size, seconds: v.getUint32(40, true) / 2 / v.getUint32(24, true) }
      },
      [text, lang],
    )
    console.log(
      `${lang} "${text}": ${(r.ms / 1000).toFixed(2)} s (first call per language includes model load), audio ${r.seconds.toFixed(2)} s`,
    )
    expect(r.tag).toBe('RIFF')
    expect(r.size).toBeGreaterThan(10_000)
    expect(r.seconds).toBeGreaterThan(minSec)
    expect(r.seconds).toBeLessThan(maxSec)
  }
  expect(external).toEqual([])
})
