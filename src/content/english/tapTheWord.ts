import type { Generator, SpriteId } from '../../core/types'
import { wrongIds } from '../helpers'

const WORDS: { en: string; sv: string; sprite: SpriteId }[] = [
  { en: 'train', sv: 'tåg', sprite: 'locomotive' },
  { en: 'tram', sv: 'spårvagn', sprite: 'tram' },
  { en: 'plane', sv: 'flygplan', sprite: 'airliner' },
  { en: 'bus', sv: 'buss', sprite: 'bus' },
  { en: 'car', sv: 'bil', sprite: 'car' },
]

/** "Tryck på train." → picture choices. Swedish support fades with level. */
export const tapTheWord: Generator = {
  id: 'en.words.tapTheWord',
  skill: 'en.words',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const count = level <= 1 || support === 'extra' ? 2 : 3
    const picked = rng.shuffle(WORDS).slice(0, count)
    const target = rng.pick(picked)
    const choices = picked.map((w) => ({
      id: w.en,
      visual: { kind: 'row' as const, items: [{ sprite: w.sprite }] },
      ariaLabel: w.sv,
    }))
    const swedishPrompt = level <= 2 || support === 'extra'
    return {
      id: `en.words.tapTheWord:${target.en}:${choices.map((c) => c.id).join('-')}`,
      skill: 'en.words',
      level,
      theme: 'train',
      prompt: swedishPrompt ? `Tryck på ${target.en}.` : `Tap the ${target.en}.`,
      speech: swedishPrompt ? 'Tryck på rätt bild.' : undefined,
      listen: { text: swedishPrompt ? target.en : `Tap the ${target.en}.`, lang: 'en' },
      scene: { kind: 'sign', text: target.en, style: 'word' },
      task: { kind: 'choice', choices, answer: target.en },
      hints: [
        { text: `${target.en} betyder ${target.sv}.` },
        { text: `Hitta ${target.sv}.`, eliminate: wrongIds(choices, target.en) },
      ],
      success: `Ja! ${target.en} = ${target.sv}.`,
    }
  },
}
