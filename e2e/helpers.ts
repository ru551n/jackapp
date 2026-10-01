import { expect, type Page } from '@playwright/test'

const NOT_A_CHOICE = /^(Lyssna|Hör på engelska|Hör ordet|På svenska|Nästa|Klart)$/

/**
 * Solves the current question by clicking enabled choices in turn until the status panel offers
 * "Nästa"/"Klart". Works for choice tasks (wrong picks get dimmed) and order tasks (placed and
 * dimmed items are aria-disabled, so the next enabled one is tried).
 */
export async function solveCurrent(page: Page) {
  const exercise = page.getByRole('main')
  const done = exercise.getByRole('button', { name: /^(Nästa|Klart)$/ })
  for (let attempt = 0; attempt < 40 && !(await done.isVisible()); attempt++) {
    const open = exercise.getByRole('button', { disabled: false }).filter({ hasNotText: NOT_A_CHOICE })
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
