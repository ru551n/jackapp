import { expect, type Page } from '@playwright/test'

/** Answers the current question by trying choices in order until it is solved (like a child might). */
export async function solveCurrent(page: Page) {
  const done = page.getByRole('status').getByRole('button', { name: /^(Nästa|Klart)$/ })
  for (let attempt = 0; attempt < 12 && !(await done.isVisible()); attempt++) {
    const open = page.locator('main button[class*="choice"]:not([aria-disabled="true"])')
    await open.first().click()
  }
  await expect(done).toBeVisible()
  await done.click()
}

/** Completes a full mission from the area start screen. */
export async function completeMission(page: Page, area: string) {
  await page.goto('./')
  await page.getByRole('link', { name: new RegExp(area) }).click()
  await page.getByRole('link', { name: 'Starta uppdrag' }).click()
  for (let i = 0; i < 4; i++) await solveCurrent(page)
  await expect(page.getByRole('heading', { name: /Klart!/ })).toBeVisible()
}
