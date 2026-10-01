import type { Generator } from '../../core/types'
import { AIRCRAFT } from '../vehicles/aircraft'
import { choiceCount, textChoices } from '../helpers'
import { AIRLINERS, FIGHTERS, hintPair, KNOWN, pickAmong, pictureChoice, qid } from './common'

/** "Tryck på namnet" under a picture. */
export const readName: Generator = {
  id: 'air.read.name',
  skill: 'air.read',
  levels: [1, 4],
  generate({ rng, level, support }) {
    // Level 1: a well-known name against names of the other kind of aircraft, so the picture settles it.
    const answer = rng.pick(level === 1 ? AIRCRAFT.filter((v) => KNOWN.includes(v.id)) : AIRCRAFT)
    const count = support === 'extra' || level <= 2 ? 2 : choiceCount(level, support)
    const other = answer.category === 'fighter' ? AIRLINERS : FIGHTERS
    const pool = level === 1 ? other : AIRCRAFT.filter((v) => v.shortName[0] !== answer.shortName[0] || level > 2)
    const names = pool.map((v) => v.shortName)
    const choices = textChoices(rng, answer.shortName, names, count)
    return {
      id: qid(
        'air.read.name',
        'name',
        answer.id,
        choices.map((c) => c.id),
      ),
      skill: 'air.read',
      level,
      theme: answer.category === 'fighter' ? 'fighter' : 'airport',
      prompt: 'Vilket namn passar flygplanet? Tryck på namnet.',
      scene: { kind: 'vehicle', vehicle: answer.id },
      task: { kind: 'choice', choices, answer: answer.shortName },
      hints: hintPair(
        choices,
        answer.shortName,
        `Namnet börjar på ${answer.shortName[0]}.`,
        `Det står ${answer.shortName}.`,
      ),
      success: `Ja! Det är ${answer.shortName}.`,
    }
  },
}

const CITIES = ['Luleå', 'Kiruna', 'Umeå', 'Visby', 'Malmö', 'Göteborg', 'Sundsvall', 'Östersund', 'Ronneby', 'Arlanda']

/** "Flyget till LULEÅ": read the city on the departure board. */
export const readDestination: Generator = {
  id: 'air.read.destination',
  skill: 'air.read',
  levels: [2, 4],
  generate({ rng, level, support }) {
    const answer = rng.pick(CITIES)
    const count = support === 'extra' || level === 2 ? 2 : 3
    const choices = textChoices(rng, answer, CITIES, count)
    return {
      id: `air.read.destination:${answer}:${choices
        .map((c) => c.id)
        .sort()
        .join('+')}`,
      skill: 'air.read',
      level,
      theme: 'airport',
      prompt: 'Vart ska flyget? Tryck på rätt stad.',
      scene: { kind: 'sign', text: `Flyg till ${answer.toUpperCase()}`, style: 'departure' },
      task: { kind: 'choice', choices, answer },
      hints: hintPair(choices, answer, `Staden börjar på ${answer[0]}.`, `På skylten står det ${answer}.`),
      success: `Ja! Flyget går till ${answer}.`,
    }
  },
}

/** Read a short sentence about an aircraft and tap the right picture. */
export const readSentence: Generator = {
  id: 'air.read.sentence',
  skill: 'air.read',
  levels: [4, 5],
  generate({ rng, level, support }) {
    const answer = rng.pick(AIRCRAFT)
    // Facts that begin with the aircraft's name, so the sentence tells which one it is.
    const named = answer.facts.filter((f) => f.startsWith(answer.shortName))
    const fact = rng.pick(named)
    const count = support === 'extra' ? 2 : level === 4 ? 3 : 4
    const options = pickAmong(rng, answer, AIRCRAFT, count)
    const choices = options.map((v, i) => pictureChoice(v, i, undefined, v.shortName))
    return {
      id: qid(
        'air.read.sentence',
        fact.slice(0, 40),
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.read',
      level,
      theme: 'airport',
      prompt: 'Läs meningen. Tryck på rätt flygplan.',
      scene: { kind: 'text', text: fact, size: 'lg' },
      task: { kind: 'choice', choices, answer: answer.id },
      hints: hintPair(
        choices,
        answer.id,
        'Första ordet i meningen är namnet på flygplanet. Titta på namnen under bilderna.',
        `Meningen handlar om ${answer.shortName}.`,
      ),
      success: `Ja! ${fact}`,
    }
  },
}
