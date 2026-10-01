import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { HOME, mockLearnerApi } from './helpers.ts'

test.skip(!existsSync('public/audio/manifest.json'), 'no generated clips (run npm run speech)')

test('Lyssna plays a bundled clip', async ({ page }) => {
  await mockLearnerApi(page)
  await page.goto(HOME)
  await page.getByRole('link', { name: /Flygplatsen/ }).click()
  await page.getByRole('link', { name: 'Starta uppdrag' }).click()
  const clip = page.waitForRequest((r) => /\/audio\/[^/]+\.mp3$/.test(r.url()))
  await page.getByRole('main').getByRole('button', { name: 'Lyssna' }).click()
  // Chromium's media stack hides the audio response from Playwright, so re-fetch the requested clip.
  expect((await page.request.get((await clip).url())).status()).toBe(200)
})
