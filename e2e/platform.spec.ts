import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

// Real platform flows against scripts/e2e-backend.mjs (app + worker + PGlite + dev mock AI).
// One shared backend: the tests build on each other (first run creates the PIN and the first learner).
test.describe.configure({ mode: 'serial' })

const PIN = '2468'

async function typePin(page: Page, submit: string) {
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: submit }).click()
}

/** Opens the adult area, unlocking it when the gate shows. */
async function openAdult(page: Page, hash = '/vuxen') {
  await page.goto(`./#${hash}`)
  const keypad = page.getByRole('textbox', { name: 'Vuxenkod' })
  const unlocked = page.getByRole('button', { name: 'Lås' })
  await expect(keypad.or(unlocked)).toBeVisible()
  if (await keypad.isVisible()) await typePin(page, 'Öppna')
  await expect(unlocked).toBeVisible()
}

test('first run: PIN, first learner, adult overview', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Skapa en vuxenkod' })).toBeVisible()
  await typePin(page, 'Nästa')
  await typePin(page, 'Spara koden')
  await expect(page.getByRole('heading', { name: 'Lägg till den första eleven' })).toBeVisible()
  await page.getByLabel('Namn').fill('Jack')
  await page.getByLabel('Skola och årskurs').selectOption({ label: 'Årskurs 1' })
  await page.getByLabel('Intressen').fill('tåg')
  await page.getByRole('button', { name: 'Klar' }).click()
  await expect(page.getByRole('heading', { name: 'Översikt för vuxna' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jack', exact: true })).toBeVisible()
  await expect(page.getByText('Årskurs 1 · Förskoleklass–åk 3')).toBeVisible()
})

const SETTLED = /^(Rätt! Bra jobbat\.|Här är svaret\. Vi tittar på det tillsammans\.|Bra att du tränar!)$/

/**
 * Answers the current run item of any kind: deliberately varied (mostly wrong) tries until the
 * server settles it (correct, or revealed after REVEAL_AFTER tries). Returns true if "Prova igen" showed.
 */
async function answerItem(page: Page): Promise<boolean> {
  const main = page.getByRole('main')
  const svara = main.getByRole('button', { name: /^(Svara|Spara svar)$/ })
  let retried = false
  for (let attempt = 0; attempt < 8; attempt++) {
    const choices = main.getByRole('group', { name: /^Välj ett( eller flera)? svar$/ })
    const ratings = main.getByRole('group', { name: /^Hur (gick det|bra stämmer ditt svar)\?$/ })
    const card = main.getByRole('button', { pressed: false }).filter({ hasText: 'Tryck för att vända kortet' })
    if (await card.isVisible()) {
      await card.click()
      continue
    }
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/answers'),
    )
    if (await ratings.isVisible()) {
      await ratings.getByRole('button').first().click()
    } else if (await choices.isVisible()) {
      const options = choices.getByRole('button')
      // Last option first: the dev mock puts the right answer first, so this starts wrong.
      const n = await options.count()
      await options.nth(n - 1 - (attempt % n)).click()
    } else if (await main.getByRole('group', { name: 'Välj en ruta här först' }).isVisible()) {
      // Early-band matching: tap a left tile, then a right one. Unpair, then pair with a new rotation.
      const lefts = main.getByRole('group', { name: 'Välj en ruta här först' }).getByRole('button')
      const rights = main.getByRole('group', { name: 'Sedan det som hör ihop' }).getByRole('button')
      const n = await lefts.count()
      for (let i = 0; i < n; i++)
        if ((await lefts.nth(i).textContent())?.includes('ihop med')) await lefts.nth(i).click()
      for (let i = 0; i < n; i++) {
        await lefts.nth(i).click()
        await rights.nth((i + attempt + 1) % n).click()
      }
    } else if (await main.getByRole('list', { name: 'Din ordning' }).isVisible()) {
      await main
        .getByRole('button', { name: /^Flytta ner/, disabled: false })
        .first()
        .click()
    } else {
      const fields = main.locator('input:not([type=checkbox]), textarea')
      const selects = main.locator('select')
      for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(`${90 + attempt}`)
      for (let i = 0; i < (await selects.count()); i++) {
        const n = (await selects.nth(i).locator('option').count()) - 1
        await selects.nth(i).selectOption({ index: 1 + ((attempt + i) % n) })
      }
    }
    if ((await svara.isVisible()) && (await svara.isEnabled())) await svara.click()
    const fb = (await (await answered).json()) as { done: boolean; message: string }
    if (fb.done) break
    if (fb.message.includes('Prova igen')) {
      await expect(main.getByText('Prova igen', { exact: false }).first()).toBeVisible()
      retried = true
    }
  }
  await expect(main.locator('p').filter({ hasText: SETTLED }).last()).toBeVisible()
  return retried
}

/** Plays a whole run from its first item. Returns whether any item asked to try again. */
async function playRun(page: Page): Promise<boolean> {
  const main = page.getByRole('main')
  await expect(main.getByRole('progressbar', { name: /^Uppgift 1 av \d+$/ })).toBeVisible()
  let retried = false
  for (let i = 0; i < 60; i++) {
    while (await main.getByRole('button', { name: 'Fortsätt' }).isVisible())
      await main.getByRole('button', { name: 'Fortsätt' }).click()
    retried = (await answerItem(page)) || retried
    const next = main.getByRole('button', { name: /^(Nästa|Se resultat|Lämna in)$/ })
    const label = await next.textContent()
    await next.click()
    if (label !== 'Nästa') return retried
  }
  throw new Error('run did not end')
}

/** Back to the start page and into a learner's area (which locks the adult gate). */
async function enterLearner(page: Page, name: string) {
  await page.goto('./#/')
  await page.getByRole('group', { name, exact: true }).getByRole('link').click()
}

test('generation with parent approval, then the learner plays it', async ({ page }) => {
  await openAdult(page)
  await page.getByRole('link', { name: 'Profil och stöd' }).click()
  await page.getByRole('radio', { name: 'Väntar tills en vuxen godkänt det' }).check()
  await page.getByRole('button', { name: 'Spara profilen' }).click()
  await expect(page.getByText('Sparat.')).toBeVisible()

  await page.getByRole('navigation', { name: 'Elevens sidor' }).getByRole('link', { name: 'Skapa material' }).click()
  await page.getByLabel('Vad vill du skapa?').fill('Skapa 6 plusuppgifter med tåg som tema, lite text.')
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByText(/Väntar på att få börja|Arbetar|Klart\./).first()).toBeVisible()
  await page.getByRole('link', { name: 'Öppna materialet' }).click({ timeout: 60_000 })
  await expect(page.getByText('Väntar på godkännande')).toBeVisible()
  await expect(page.getByText('Materialet klarade kontrollen.')).toBeVisible()

  // Not visible to the learner before approval; entering the learner area locks the adult gate.
  await enterLearner(page, 'Jack')
  await expect(page.getByRole('heading', { name: 'Mitt äventyr' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Nya uppdrag/ })).toHaveCount(0)
  await page.goto('./#/vuxen')
  await expect(page.getByRole('textbox', { name: 'Vuxenkod' })).toBeVisible()

  await openAdult(page)
  await page.getByRole('link', { name: '1 material väntar på godkännande' }).click()
  await page
    .getByRole('link', { name: /Addition/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Godkänn' }).click()
  await expect(page.getByText('Godkänt', { exact: true })).toBeVisible()

  await enterLearner(page, 'Jack')
  await page.getByRole('link', { name: /Nya uppdrag/ }).click()
  await page
    .getByRole('link', { name: /Addition/ })
    .first()
    .click()
  expect(await playRun(page)).toBe(true)
  await expect(page.getByText('Bra jobbat! Uppdraget är klart.')).toBeVisible()
  await page.goto('./#/vuxen')
  await expect(page.getByRole('textbox', { name: 'Vuxenkod' })).toBeVisible()
})

test('study upload: image + PDF, strict test with free text, approval, learner answers', async ({ page }) => {
  const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#cfe8ff' } })
    .png()
    .toBuffer()
  await openAdult(page)
  await page.getByRole('link', { name: 'Jack', exact: true }).click()
  // Free text is for årskurs 4 and up: Jack moves up a few years for this test.
  await page.getByRole('link', { name: 'Profil och stöd' }).click()
  await page.getByLabel('Skola och årskurs').selectOption({ label: 'Årskurs 4' })
  await page.getByRole('button', { name: 'Spara profilen' }).click()
  await expect(page.getByText('Sparat.')).toBeVisible()
  await page.getByRole('navigation', { name: 'Elevens sidor' }).getByRole('link', { name: 'Studiematerial' }).click()
  await page.getByLabel('Titel (valfri)').fill('Djur i skogen')
  await page.getByLabel('Välj filer').setInputFiles([
    { name: 'sida1.png', mimeType: 'image/png', buffer: png },
    { name: 'skogen.pdf', mimeType: 'application/pdf', buffer: readFileSync('e2e/fixtures/skogen.pdf') },
  ])
  await expect(page.getByRole('list', { name: 'Sidor i ordning' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Ladda upp 2 sidor' }).click()
  await expect(page.getByText('Materialet är klart.')).toBeVisible({ timeout: 60_000 })

  await page
    .getByRole('list', { name: 'Studiematerial' })
    .getByRole('button', { name: /Djur i skogen/ })
    .click()
  await page.getByRole('button', { name: 'Skapa övningsprov' }).click()
  await page.getByRole('radio', { name: /Bara från materialet/ }).check()
  await page.getByRole('radio', { name: 'Flerval + eget svar' }).check()
  await page.getByLabel('Antal frågor').fill('4')
  await page.getByRole('button', { name: 'Skapa provet' }).click()
  await expect(page.getByText('Väntar på godkännande')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Övningsprov', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Godkänn' }).click()
  await expect(page.getByText('Godkänt', { exact: true })).toBeVisible()

  await enterLearner(page, 'Jack')
  await page
    .getByRole('link', { name: /Addition/ })
    .first()
    .click()
  // Free text is graded by the (mock) AI against the material: answering with the quoted words covers the key point.
  const main = page.getByRole('main')
  let freeTexts = 0
  for (let i = 0; i < 4; i++) {
    await expect(main.getByRole('progressbar', { name: `Uppgift ${i + 1} av 4` })).toBeVisible()
    if (await main.locator('textarea').isVisible()) {
      const prompt = (await main.getByRole('heading', { level: 2 }).textContent()) ?? ''
      await main.locator('textarea').fill(`Texten handlar om ${/"([^"]+)"/.exec(prompt)?.[1]}.`)
      await main.getByRole('button', { name: 'Svara' }).click()
      await expect(main.getByText('Det här fanns med')).toBeVisible()
      freeTexts++
    } else await answerItem(page)
    await main.getByRole('button', { name: /^(Nästa|Se resultat)$/ }).click()
  }
  expect(freeTexts).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: /^Du klarade \d+ av 4$/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dina egna svar' })).toBeVisible()
})

test('middle learner: free-text request, approved by the adult, is playable', async ({ page }) => {
  await openAdult(page)
  await page.getByRole('link', { name: 'Lägg till elev' }).click()
  await page.getByLabel('Namn').fill('Mira')
  await page.getByLabel('Skola och årskurs').selectOption({ label: 'Årskurs 5' })
  await page.getByRole('button', { name: 'Lägg till' }).click()
  await page.getByLabel('Eleven får be om eget material').check()
  await page.getByRole('radio', { name: 'Kan användas direkt när det klarat kontrollen' }).check()
  await page.getByRole('button', { name: 'Spara profilen' }).click()
  await expect(page.getByText('Sparat.')).toBeVisible()

  await enterLearner(page, 'Mira')
  await expect(page.getByRole('heading', { name: 'Hej Mira!' })).toBeVisible()
  await page.getByRole('link', { name: 'Önska uppdrag' }).click()
  await page.getByLabel('Vad vill du lära dig?').fill('Jag vill lära mig bråk med flygplan')
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  // Learner-made material waits for an adult (newer servers), or is ready at once (immediate policy).
  const ready = page.getByText('Ditt uppdrag är klart!')
  const waits = page.getByText('En vuxen tittar på uppdraget först.')
  await expect(ready.or(waits)).toBeVisible({ timeout: 60_000 })
  if (await waits.isVisible()) {
    await openAdult(page)
    await page.getByRole('link', { name: '1 material väntar på godkännande' }).click()
    await page
      .getByRole('link', { name: /Addition/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Godkänn' }).click()
    await expect(page.getByText('Godkänt', { exact: true })).toBeVisible()
    await enterLearner(page, 'Mira')
    await page
      .getByRole('link', { name: /Addition/ })
      .first()
      .click()
  } else await page.getByRole('link', { name: 'Starta' }).click()
  await playRun(page)
  await expect(page.getByRole('heading', { name: /^Du klarade \d+ av \d+$/ })).toBeVisible()
})
