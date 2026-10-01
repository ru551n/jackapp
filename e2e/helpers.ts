import { expect, type Page } from '@playwright/test'

const NOT_A_CHOICE = /^(Lyssna|Hör på engelska|Hör ordet|På svenska|Nästa|Klart)$/

export const LEARNER_ID = '00000000-0000-4000-8000-0000000000e2'
/** The early-years learner home. */
export const HOME = `./#/l/${LEARNER_ID}`

/**
 * The static preview has no API: answer the learner-mode calls with an early-band learner (year 1,
 * default support preferences) and empty lists.
 */
export async function mockLearnerApi(page: Page) {
  const school = { stage: 'grundskola', year: 1 }
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/v1/learners/${LEARNER_ID}`)
      return route.fulfill({
        json: {
          id: LEARNER_ID,
          displayName: 'Jack',
          school,
          ageBand: 'early',
          language: 'sv',
          learnerRequestsAllowed: false,
          presentation: {
            textAmount: 'normal',
            visualSupport: 'normal',
            maxChoices: 4,
            readAloud: true,
            reducedMotion: false,
            sound: false,
            stepByStep: false,
            repetition: 'normal',
            pace: 'normal',
            sessionMinutes: 15,
            extraThinkingTime: false,
            reducedVisualComplexity: false,
            ageBand: 'early',
            school,
          },
        },
      })
    return route.fulfill({ json: [] })
  })
}

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
  await page.goto(HOME)
  await page.getByRole('link', { name: new RegExp(area) }).click()
  await page.getByRole('link', { name: 'Starta uppdrag' }).click()
  for (let i = 0; i < 4; i++) await solveCurrent(page)
  await expect(page.getByRole('heading', { name: /Bra jobbat!/ })).toBeVisible()
}
