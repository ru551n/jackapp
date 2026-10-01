import { expect, test } from '@playwright/test'
import { completeMission, HOME, LEARNER_ID, mockLearnerApi } from './helpers.ts'

test.beforeEach(({ page }) => mockLearnerApi(page))

test('home shows the transport destinations and no free play by default', async ({ page }) => {
  await page.goto(HOME)
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
  for (const name of ['Stationen', 'Tunnelbanan', 'Spårvagnen', 'Flygplatsen', 'Engelska', 'Min samling']) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: /Bygg din linje/ })).toHaveCount(0)
})

for (const area of ['Stationen', 'Tunnelbanan', 'Spårvagnen', 'Flygplatsen', 'Engelska']) {
  test(`a child can complete a mission in ${area}`, async ({ page }) => {
    await completeMission(page, area)
    await expect(page.getByRole('button', { name: 'Ett uppdrag till' })).toBeVisible()
  })
}

test('progress survives a reload', async ({ page }) => {
  await completeMission(page, 'Flygplatsen')
  await page.reload()
  const saved = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`jackapp:v1:${id}`)!).missions.flygplatsen,
    LEARNER_ID,
  )
  expect(saved).toBe(1)
})
