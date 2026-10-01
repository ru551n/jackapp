import { expect, test } from '@playwright/test'
import { completeMission, HOME, LEARNER_ID, mockLearnerApi } from './helpers.ts'

test.beforeEach(({ page }) => mockLearnerApi(page))

test('corrupt localStorage still renders home', async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem(`jackapp:v1:${id}`, '{not json'), LEARNER_ID)
  await page.goto(HOME)
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
})

test('a finished mission unlocks Gripen in the collection', async ({ page }) => {
  await completeMission(page, 'Flygplatsen')
  await expect(page.getByText('Ny i din samling: Gripen')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Titta på Gripen' })).toBeVisible()
  await page.goto(`${HOME}/samling`)
  await expect(page.getByRole('link', { name: /Gripen/ })).toBeVisible()
})

test('free play is not reachable by URL when disabled', async ({ page }) => {
  await page.goto(`${HOME}/bygg`)
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bygg din linje' })).toHaveCount(0)
})

test('legacy progress is offered once, moved to the learner and kept', async ({ page }) => {
  const legacy = JSON.stringify({ version: 1, missions: { flygplatsen: 1 }, settings: { freePlayEnabled: true } })
  await page.addInitScript(
    (raw) => localStorage.getItem('jackapp:v1') ?? localStorage.setItem('jackapp:v1', raw),
    legacy,
  )
  await page.goto(HOME)
  await page.getByRole('button', { name: 'Ja, flytta till Jack' }).click()
  await expect(page.getByRole('link', { name: /Bygg din linje/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Bygg din linje/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('jackapp:v1'))).toBe(legacy)
})
