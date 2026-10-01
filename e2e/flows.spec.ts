import { expect, test } from '@playwright/test'
import { completeMission } from './helpers.ts'

test('corrupt localStorage still renders home', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jackapp:v1', '{not json'))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
})

test('a finished mission unlocks Gripen in the collection', async ({ page }) => {
  await completeMission(page, 'Flygplatsen')
  await expect(page.getByText('Ny i din samling: Gripen')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Titta på Gripen' })).toBeVisible()
  await page.goto('./#/samling')
  await expect(page.getByRole('link', { name: /Gripen/ })).toBeVisible()
})

test('free play is not reachable by URL when disabled', async ({ page }) => {
  await page.goto('./#/bygg')
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bygg din linje' })).toHaveCount(0)
})

test('parent flow: set PIN, enable free play, it persists', async ({ page }) => {
  await page.goto('./#/vuxen')
  const sum = (await page.getByTestId('sum').innerText()).match(/(\d+)\s*\+\s*(\d+)/)!
  await page.getByLabel(/Skriv svaret/).fill(String(Number(sum[1]) + Number(sum[2])))
  await page.getByRole('button', { name: 'Fortsätt' }).click()
  for (const submit of ['Nästa', 'Spara koden']) {
    await page.getByLabel(/kod/i).fill('2468')
    await page.getByRole('button', { name: submit }).click()
  }
  await page.getByRole('checkbox', { name: /Fri lek/ }).check()
  await page.goto('./')
  await expect(page.getByRole('link', { name: /Bygg din linje/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: /Bygg din linje/ })).toBeVisible()
})
