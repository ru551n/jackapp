import type { Generator } from '../../core/types'
import { AIRCRAFT } from '../vehicles/aircraft'
import { choiceCount } from '../helpers'
import { AIRLINERS, FEATURE, FIGHTERS, hintPair, KNOWN, pickAmong, pickDistinct, pictureChoice, qid } from './common'

/** "Vilket flygplan är Gripen?" Colour pictures first, silhouettes from level 4. */
export const recognizeName: Generator = {
  id: 'air.recognize.name',
  skill: 'air.recognize',
  levels: [1, 5],
  generate({ rng, level, support }) {
    // Level 1: only well-known names, and the name is also written under each picture.
    const answer = rng.pick(level === 1 ? AIRCRAFT.filter((v) => KNOWN.includes(v.id)) : AIRCRAFT)
    const same = answer.category === 'fighter' ? FIGHTERS : AIRLINERS
    const other = answer.category === 'fighter' ? AIRLINERS : FIGHTERS
    const count = choiceCount(level, support)
    // Level 1-2: easy contrast (a different kind of aircraft); level 3+: look-alikes that still differ in shape.
    const picks =
      level <= 2 ? [answer, ...rng.shuffle(other).slice(0, count - 1)] : pickDistinct(rng, answer, same, count)
    const view = level >= 4 && support !== 'extra' ? 'silhouette' : undefined
    const options = rng.shuffle(picks)
    const choices = options.map((v, i) => pictureChoice(v, i, view, level === 1 ? v.shortName : undefined))
    return {
      id: qid(
        'air.recognize.name',
        view ? 'sil' : 'art',
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.recognize',
      level,
      theme: answer.category === 'fighter' ? 'fighter' : 'airport',
      prompt: `Vilket flygplan är ${answer.shortName}?`,
      scene: { kind: 'text', text: answer.shortName, size: 'xl' },
      task: { kind: 'choice', choices, answer: answer.id },
      hints: hintPair(
        choices,
        answer.id,
        level === 1 ? `${FEATURE[answer.id]} Namnet står under bilden.` : FEATURE[answer.id],
        `Det är ${answer.shortName}. Titta på formen igen.`,
      ),
      success: `Ja! Det är ${answer.shortName}.`,
    }
  },
}

/** "Vilket flygplan kommer från Sverige?" */
export const recognizeSwedish: Generator = {
  id: 'air.recognize.sweden',
  skill: 'air.recognize',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const answer = rng.pick(AIRCRAFT.filter((v) => v.swedish))
    const count = support === 'extra' ? 2 : level <= 3 ? 3 : 4
    const options = pickAmong(
      rng,
      answer,
      AIRCRAFT.filter((v) => !v.swedish),
      count,
    )
    const choices = options.map((v, i) => pictureChoice(v, i, undefined, v.shortName))
    return {
      id: qid(
        'air.recognize.sweden',
        'country',
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.recognize',
      level,
      theme: 'fighter',
      prompt: 'Vilket flygplan kommer från Sverige?',
      task: { kind: 'choice', choices, answer: answer.id },
      hints: hintPair(
        choices,
        answer.id,
        'Saab bygger flygplan i Sverige. Titta på namnen: Gripen, Viggen, Draken och Saab 340 är svenska.',
        `${answer.shortName} är byggt av Saab i Sverige.`,
      ),
      success: `Ja! ${answer.shortName} kommer från Sverige.`,
    }
  },
}

/** "Vilket är ett passagerarflygplan?" */
export const recognizeAirliner: Generator = {
  id: 'air.recognize.airliner',
  skill: 'air.recognize',
  levels: [1, 3],
  generate({ rng, level, support }) {
    const answer = rng.pick(AIRLINERS)
    const count = support === 'extra' || level === 1 ? 2 : 3
    const options = rng.shuffle([answer, ...rng.shuffle(FIGHTERS).slice(0, count - 1)])
    const choices = options.map((v, i) => pictureChoice(v, i))
    return {
      id: qid(
        'air.recognize.airliner',
        'kind',
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.recognize',
      level,
      theme: 'airport',
      prompt: 'Vilket flygplan är ett passagerarflygplan?',
      task: { kind: 'choice', choices, answer: answer.id },
      hints: hintPair(
        choices,
        answer.id,
        'Ett passagerarflygplan har en lång, rund kropp där människor sitter. Stridsflygplan är smala och spetsiga.',
        `${answer.shortName} är ett passagerarflygplan.`,
      ),
      success: `Ja! ${answer.shortName} är ett passagerarflygplan.`,
    }
  },
}

/** Match a picture to its silhouette ("skugga"). */
export const recognizeShadow: Generator = {
  id: 'air.recognize.shadow',
  skill: 'air.recognize',
  levels: [3, 5],
  generate({ rng, level, support }) {
    const answer = rng.pick(AIRCRAFT)
    const same = answer.category === 'fighter' ? FIGHTERS : AIRLINERS
    const count = choiceCount(level, support)
    const options = pickDistinct(rng, answer, level === 3 ? AIRCRAFT : same, count)
    const choices = options.map((v, i) => pictureChoice(v, i, 'silhouette'))
    return {
      id: qid(
        'air.recognize.shadow',
        'match',
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.recognize',
      level,
      theme: 'fighter',
      prompt: 'Vilken skugga passar flygplanet?',
      scene: { kind: 'vehicle', vehicle: answer.id },
      task: { kind: 'choice', choices, answer: answer.id },
      hints: hintPair(
        choices,
        answer.id,
        FEATURE[answer.id],
        `Jämför vingar, motorer och stjärt med bilden. Skuggan är ${answer.shortName}.`,
      ),
      success: `Ja! Skuggan är ${answer.shortName}.`,
    }
  },
}
