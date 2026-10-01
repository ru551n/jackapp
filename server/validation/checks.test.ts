import { describe, expect, it } from 'vitest'
import type { Item } from '../../shared/contracts'
import { age, answers, grounding, language, leakage, math, safety, schema } from './checks'
import { containsWords, detectLanguage, keyTerms, stem } from './text'
import { KINDS, MATERIAL, SET, artifact, codes, ctx, item, request, upload } from './fixtures'

type Case = [name: string, item: Item, expected: string[]]

describe('good fixtures pass every item check', () => {
  it.each(KINDS)('%s', (kind) => {
    const i = item(kind)
    const c = ctx()
    for (const check of [answers, math, leakage, language, age, safety, grounding]) expect(check(i, c)).toEqual([])
  })
})

describe('schema', () => {
  it('passes a good artifact', () => {
    expect(schema(artifact([item('trueFalse')]), ctx())).toEqual([])
  })
  it.each([
    ['duplicate item ids', artifact([item('trueFalse'), item('trueFalse')]), ctx(), ['schema.duplicate_item_id']],
    [
      'empty section',
      artifact([], {
        sections: [
          { kind: 'practice', items: [item('trueFalse')] },
          { kind: 'text', title: 'Tom' },
        ],
      }),
      ctx(),
      ['schema.empty_section'],
    ],
    ['type mismatch', artifact([item('trueFalse')], { type: 'lesson' }), ctx(), ['schema.type_mismatch']],
    [
      'test count off by one',
      artifact([item('trueFalse')], { type: 'practiceTest' }),
      ctx({ request: request({ type: 'practiceTest', questionCount: 2 }) }),
      ['schema.item_count'],
    ],
    [
      'unrequested kind',
      artifact([item('trueFalse')]),
      ctx({ request: request({ itemKinds: ['numeric'] }) }),
      ['schema.unrequested_kind'],
    ],
  ])('%s', (_n, a, c, want) => expect(codes(schema(a, c))).toEqual(want))

  it('item count is an error for tests, a warning otherwise', () => {
    const test = schema(
      artifact([item('trueFalse')], { type: 'practiceTest' }),
      ctx({ request: request({ type: 'practiceTest', questionCount: 3 }) }),
    )
    expect(test[0]!.severity).toBe('error')
    const ex = schema(artifact([item('trueFalse')]), ctx({ request: request({ questionCount: 3 }) }))
    expect(ex[0]!.severity).toBe('warning')
  })
})

describe('answers', () => {
  const choices = (...t: string[]) => t.map((text, i) => ({ id: String.fromCharCode(97 + i), text }))
  it.each<Case>([
    ['mc answer missing', item('multipleChoice', { answer: 'z' }), ['answers.unknown_answer']],
    [
      'mc duplicate ids',
      item('multipleChoice', {
        choices: [
          { id: 'a', text: 'Katt' },
          { id: 'a', text: 'Hund' },
        ],
      }),
      ['answers.duplicate_choice_id'],
    ],
    [
      'mc duplicate texts',
      item('multipleChoice', { choices: choices('Katt', ' katt ') }),
      ['answers.duplicate_choice_text'],
    ],
    ['mc empty choice', item('multipleChoice', { choices: choices('Katt', '  ') }), ['answers.empty_choice']],
    ['ms unknown answer', item('multiSelect', { answers: ['a', 'q'] }), ['answers.unknown_answer']],
    ['ms duplicate answer', item('multiSelect', { answers: ['a', 'a'] }), ['answers.duplicate_answer']],
    ['ms all correct', item('multiSelect', { answers: ['a', 'b', 'c'] }), ['answers.all_correct']],
    ['ordering missing id', item('ordering', { answer: ['a', 'b'] }), ['answers.not_permutation']],
    ['ordering repeated id', item('ordering', { answer: ['a', 'a', 'b'] }), ['answers.not_permutation']],
    ['ordering unknown id', item('ordering', { answer: ['a', 'b', 'x'] }), ['answers.not_permutation']],
    [
      'matching duplicate left',
      item('matching', {
        pairs: [
          { left: 'Katt', right: 'mjau' },
          { left: 'katt', right: 'voff' },
        ],
      }),
      ['answers.duplicate_left'],
    ],
    [
      'matching duplicate right',
      item('matching', {
        pairs: [
          { left: 'Katt', right: 'mjau' },
          { left: 'Lejon', right: 'Mjau' },
        ],
      }),
      ['answers.duplicate_right'],
    ],
    [
      'matching empty side',
      item('matching', {
        pairs: [
          { left: 'Katt', right: '' },
          { left: 'Hund', right: 'voff' },
        ],
      }),
      ['answers.empty_pair'],
    ],
    ['fillBlank too few blanks', item('fillBlank', { text: 'Katten sitter.' }), ['answers.blank_count']],
    [
      'fillBlank too many blanks',
      item('fillBlank', { text: '___ ___ på mattan.', blanks: [{ accepted: ['Katten'] }] }),
      ['answers.blank_count'],
    ],
    ['fillBlank empty accepted', item('fillBlank', { blanks: [{ accepted: [' '] }] }), ['answers.blank_empty']],
    ['freeText blank rubric', item('freeText', { rubric: ['  '] }), ['answers.empty_rubric']],
    ['flashcard blank back', item('flashcard', { back: ' ' }), ['answers.empty_back']],
    ['numeric NaN', { ...item('numeric'), answer: Number.NaN } as Item, ['answers.missing']],
    ['trueFalse missing', { ...item('trueFalse'), answer: undefined } as unknown as Item, ['answers.missing']],
  ])('%s', (_n, i, want) => expect(codes(answers(i, ctx()))).toEqual(want))

  it('respects support.maxChoices', () => {
    const c = ctx({ request: request({ support: { maxChoices: 2 } }) })
    expect(codes(answers(item('multipleChoice'), c))).toEqual(['answers.too_many_choices'])
    expect(answers(item('multipleChoice'), ctx())).toEqual([])
  })
  it('every answers issue is an error with itemId and a Swedish message', () => {
    for (const issue of answers(item('multipleChoice', { answer: 'z' }), ctx())) {
      expect(issue.severity).toBe('error')
      expect(issue.itemId).toBe('i-multipleChoice')
      expect(issue.message).toMatch(/svar/)
    }
  })
})

describe('math', () => {
  const num = (over: Record<string, unknown>) => item('numeric', over)
  const mc = (prompt: string, texts: string[], answer = 'a') =>
    item('multipleChoice', { prompt, answer, choices: texts.map((text, i) => ({ id: 'abcd'[i]!, text })) })
  it.each<Case>([
    ['check agrees', num({}), []],
    ['check disagrees', num({ answer: 54 }), ['math.answer_mismatch']],
    ['check with comma decimals', num({ prompt: 'Räkna ut summan.', check: '2,5+1,25', answer: 3.75 }), []],
    ['fraction check', num({ prompt: 'Hur mycket är tre fjärdedelar av 12?', check: '(3/4)*12', answer: 9 }), []],
    [
      'tolerance accepted',
      num({ prompt: 'Ungefär hur mycket är roten ur 2?', check: 'sqrt(2)', answer: 1.41, tolerance: 0.01 }),
      [],
    ],
    [
      'tolerance exceeded',
      num({ prompt: 'Ungefär hur mycket är roten ur 2?', check: 'sqrt(2)', answer: 1.4, tolerance: 0.01 }),
      ['math.answer_mismatch'],
    ],
    ['malformed check', num({ check: '7**' }), ['math.check_invalid']],
    ['injection in check', num({ check: 'process.exit(1)' }), ['math.check_invalid']],
    ['division by zero in check', num({ prompt: 'Dela kakan.', check: '1/0' }), ['math.check_invalid']],
    ['check disagrees with prompt', num({ check: '7*9', answer: 63 }), ['math.check_mismatch']],
    ['no check, prompt verifies', num({ check: undefined }), []],
    ['no check, prompt disagrees', num({ check: undefined, answer: 57 }), ['math.answer_mismatch']],
    ['no check, percent prompt', num({ prompt: 'Vad är 20 % av 50?', check: undefined, answer: 10 }), []],
    [
      'no check, word problem',
      num({ prompt: 'Lisa har 3 äpplen och får 4 till. Hur många har hon?', check: undefined, answer: 7 }),
      ['math.unverified'],
    ],
    ['mc exactly one correct', mc('Vad är 6 + 7?', ['13', '12', '14']), []],
    ['mc wrong one marked', mc('Vad är 6 + 7?', ['12', '13', '14']), ['math.mc_wrong_answer']],
    ['mc none correct', mc('Vad är 6 + 7?', ['12', '11', '14']), ['math.mc_no_correct']],
    ['mc two correct', mc('Vad är 6 + 7?', ['13', '13,0', '14']), ['math.mc_multiple_correct']],
    ['mc comma decimals', mc('Vad är 1,5 + 1,5?', ['3', '2,5']), []],
    ['mc non-numeric choices skipped', mc('Vad är 6 + 7?', ['tretton', '12']), []],
    ['mc word prompt skipped', mc('Vilket tal är störst?', ['3', '9'], 'b'), []],
    ['unit ok', num({ prompt: 'Vad är 3 m + 40 cm i cm?', check: '300+40', answer: 340, unit: 'cm' }), []],
    [
      'unit area from lengths',
      num({ prompt: 'En rektangel är 3 cm och 4 cm. Vad är arean?', check: '3*4', answer: 12, unit: 'cm²' }),
      [],
    ],
    [
      'unit compound',
      num({ prompt: 'Äpplen kostar 20 kr/kg. Vad kostar 3 kg?', check: '20*3', answer: 60, unit: 'kr' }),
      [],
    ],
    [
      'unit mismatch',
      num({ prompt: 'Ett rep är 5 m och ett annat 3 m. Hur långt totalt?', check: '5+3', answer: 8, unit: 'kg' }),
      ['math.unit_mismatch'],
    ],
    ['unit unknown', num({ unit: 'blorp' }), ['math.unit_unknown']],
  ])('%s', (_n, i, want) => expect(codes(math(i, ctx()))).toEqual(want))

  it('mismatch message shows the computed value in Swedish format', () => {
    const [issue] = math(num({ prompt: 'Räkna.', check: '1/4', answer: 0.2 }), ctx())
    expect(issue!.message).toContain('0,25')
  })
  it('unverified is only a warning', () => {
    expect(
      math(num({ prompt: 'Hur många ben har en spindel?', check: undefined, answer: 8 }), ctx())[0]!.severity,
    ).toBe('warning')
  })
})

describe('leakage', () => {
  it.each<Case>([
    ['numeric answer after =', item('numeric', { prompt: 'Vad är 7 × 8? (7 × 8 = 56)' }), ['leakage.answer_in_prompt']],
    ['numeric = other number', item('numeric', { prompt: 'Om 7 × 7 = 49, vad är 7 × 8?', check: '7*8' }), []],
    ['numeric hint has answer', item('numeric', { hints: ['Svaret är 56.'] }), ['leakage.hint_reveals_answer']],
    [
      'numeric small answer in hint is fine',
      item('numeric', { prompt: 'Vad är 1 + 1?', check: '1+1', answer: 2, hints: ['Räkna 2 fingrar.'] }),
      [],
    ],
    [
      'mc answer only in prompt',
      item('multipleChoice', { prompt: 'En katt säger mjau. Vilket djur säger mjau?' }),
      ['leakage.answer_in_prompt'],
    ],
    ['mc all choices in prompt is fine', item('multipleChoice', { prompt: 'Säger katt, hund eller ko mjau?' }), []],
    ['mc hint gives answer', item('multipleChoice', { hints: ['Det är en katt.'] }), ['leakage.hint_reveals_answer']],
    ['mc second hint may be specific', item('multipleChoice', { hints: ['Den har morrhår.', 'Det är en katt.'] }), []],
    ['fillBlank answer in prompt', item('fillBlank', { prompt: 'Använd ordet sitter.' }), ['leakage.answer_in_prompt']],
    [
      'fillBlank hint gives answer',
      item('fillBlank', { hints: ['Ordet är sitter.'] }),
      ['leakage.hint_reveals_answer'],
    ],
    [
      'flashcard identical sides',
      item('flashcard', { prompt: 'Stockholm', back: 'stockholm' }),
      ['leakage.answer_in_prompt'],
    ],
    [
      'flashcard back in prompt',
      item('flashcard', { prompt: 'Är Stockholm huvudstaden i Sverige?' }),
      ['leakage.answer_in_prompt'],
    ],
    [
      'explanation already in prompt',
      item('trueFalse', {
        prompt: 'Solen är en stjärna. Solen är en stjärna eftersom den lyser själv.',
        explanation: 'Solen är en stjärna eftersom den lyser själv.',
      }),
      ['leakage.explanation_before_answer'],
    ],
    [
      'explanation as hint',
      item('trueFalse', {
        hints: ['Solen är en stjärna eftersom den lyser själv.'],
        explanation: 'Solen är en stjärna eftersom den lyser själv.',
      }),
      ['leakage.explanation_before_answer'],
    ],
    [
      'explanation after answering is fine',
      item('trueFalse', { explanation: 'Solen är en stjärna eftersom den lyser själv.' }),
      [],
    ],
    [
      'short answers ignored',
      item('multipleChoice', {
        prompt: 'Är ko ett djur?',
        choices: [
          { id: 'a', text: 'Ko' },
          { id: 'b', text: 'Sten' },
        ],
      }),
      [],
    ],
  ])('%s', (_n, i, want) => expect(codes(leakage(i, ctx()))).toEqual(want))
})

describe('language', () => {
  const english = request({ subjectCode: 'GRGRENG01' })
  it.each([
    ['swedish item, swedish prompt', item('trueFalse'), request(), []],
    [
      'english item outside English',
      item('trueFalse', { lang: 'en', prompt: 'The sun is a star.' }),
      request(),
      ['language.unexpected_lang'],
    ],
    [
      'english prompt labelled sv',
      item('trueFalse', { prompt: 'Is the sun a star and is it hot?' }),
      request(),
      ['language.unexpected_lang'],
    ],
    [
      'english item in English',
      item('trueFalse', { lang: 'en', prompt: 'The sun is a star and it is hot.' }),
      english,
      [],
    ],
    [
      'gymnasium English code',
      item('trueFalse', { lang: 'en', prompt: 'The sun is a star.' }),
      request({ subjectCode: 'ENGE' }),
      [],
    ],
    [
      'English via topic',
      item('trueFalse', { lang: 'en', prompt: 'The sun is a star.' }),
      request({ topic: 'Engelska glosor' }),
      [],
    ],
    [
      'mislabelled within English',
      item('trueFalse', { lang: 'en', prompt: 'Är det här en katt och är den svart?' }),
      english,
      ['language.mismatch'],
    ],
    [
      'modern languages allow any',
      item('trueFalse', { lang: 'de', prompt: 'Die Sonne ist ein Stern.' }),
      request({ subjectCode: 'GRGRMSP01' }),
      [],
    ],
    ['too little text to judge', item('trueFalse', { prompt: 'Hund?' }), request(), []],
  ])('%s', (_n, i, r, want) => expect(codes(language(i, ctx({ request: r })))).toEqual(want))

  it('allows the material language', () => {
    const i = item('trueFalse', { lang: 'en', prompt: 'The water is in the sea.' })
    expect(language(i, ctx({ material: { ...MATERIAL, language: 'en' } }))).toEqual([])
  })
})

describe('age', () => {
  const long = (n: number) =>
    item('trueFalse', { prompt: `${'Ja '.repeat(Math.ceil(n / 3))}`.slice(0, n).trim() + '.' })
  it.each([
    ['short early prompt', item('trueFalse'), ctx(), []],
    ['early, normal text, too long', long(200), ctx(), ['age.prompt_too_long', 'age.long_sentence']],
    [
      'early, minimal text',
      item('trueFalse', { prompt: 'Solen är en stjärna. Den lyser hela dagen. Den värmer jorden.' }),
      ctx({ request: request({ support: { textAmount: 'minimal' } }) }),
      ['age.prompt_too_long'],
    ],
    ['middle band allows more', long(200), ctx({ band: 'middle' }), []],
    ['upper band', long(1100), ctx({ band: 'upper' }), ['age.prompt_too_long']],
    [
      'long sentence for early',
      item('trueFalse', { prompt: 'Solen är en stor och varm stjärna som lyser på oss varje dag när vi är ute.' }),
      ctx(),
      ['age.long_sentence'],
    ],
    ['short sentences ok', item('trueFalse', { prompt: 'Solen är varm. Den lyser. Den är en stjärna.' }), ctx(), []],
    [
      'difficult words for early',
      item('trueFalse', { prompt: 'Fotosyntesen omvandlar koldioxid energirikt.' }),
      ctx(),
      ['age.difficult_words'],
    ],
    [
      'difficult words fine for upper',
      item('trueFalse', { prompt: 'Fotosyntesen omvandlar koldioxid energirikt.' }),
      ctx({ band: 'upper' }),
      [],
    ],
  ])('%s', (_n, i, c, want) => expect(codes(age(i, c))).toEqual(want))

  it('more than twice the limit is an error', () => {
    expect(age(long(400), ctx())[0]!.severity).toBe('error')
    expect(
      age(long(300), ctx({ band: 'middle', request: request({ support: { textAmount: 'reduced' } }) }))[0]!.severity,
    ).toBe('warning')
  })
})

describe('safety', () => {
  it.each([
    ['plain item', item('trueFalse'), []],
    ['weapon', item('trueFalse', { prompt: 'Ett vapen är farligt.' }), ['safety.blocked']],
    ['kill in a hint', item('trueFalse', { hints: ['Lejonet dödar zebran.'] }), ['safety.blocked']],
    [
      'english weapon in choice',
      item('multipleChoice', {
        choices: [
          { id: 'a', text: 'A gun' },
          { id: 'b', text: 'A cat' },
        ],
      }),
      ['safety.blocked'],
    ],
    [
      'history war is borderline',
      item('trueFalse', { prompt: 'Andra världskriget slutade 1945.' }),
      ['safety.borderline'],
    ],
    [
      'aircraft engineering is fine',
      item('trueFalse', { prompt: 'Gripen är ett jaktplan med deltavinge och canardvingar.' }),
      [],
    ],
    ['aircraft + combat', item('trueFalse', { prompt: 'Gripen kan attackera fiender.' }), ['safety.aviation_combat']],
    ['aircraft + missiles', item('trueFalse', { prompt: 'Stridsflygplanet bär missiler.' }), ['safety.blocked']],
    ['air force stays borderline', item('trueFalse', { prompt: 'Gripen flygs av flygvapnet.' }), ['safety.borderline']],
    ['pomegranate is fine', item('trueFalse', { prompt: 'Ett granatäpple är en frukt.' }), []],
    ['dead leaves are borderline', item('trueFalse', { prompt: 'Döda löv faller.' }), ['safety.borderline']],
  ])('%s', (_n, i, want) => expect(codes(safety(i, ctx()))).toEqual(want))
})

describe('grounding', () => {
  const grounded = (over: Record<string, unknown> = {}) =>
    item('multipleChoice', {
      prompt: 'Vad bildas när vattenångan kyls av?',
      choices: [
        { id: 'a', text: 'Moln' },
        { id: 'b', text: 'Sand' },
      ],
      sources: [upload('s3', 2, 'bildar moln')],
      ...over,
    })
  const strict = ctx({ material: MATERIAL, sourceMode: 'strict', band: 'middle' })
  const mixed = ctx({ material: MATERIAL, band: 'middle' })
  const extended = ctx({ material: MATERIAL, sourceMode: 'extended', band: 'middle' })
  const offTopic = {
    prompt: 'Vem uppfann telefonen?',
    choices: [
      { id: 'a', text: 'Graham Bell' },
      { id: 'b', text: 'Edison' },
    ],
  }

  it.each([
    ['grounded, strict', grounded(), strict, []],
    [
      'inflected terms are supported',
      grounded({
        prompt: 'Vad händer när vattnet avdunstar?',
        choices: [
          { id: 'a', text: 'Det blir vattenånga' },
          { id: 'b', text: 'Det fryser' },
        ],
        sources: [upload('s1', 1)],
      }),
      strict,
      [],
    ],
    [
      'strict without upload source',
      grounded({ sources: [{ kind: 'model', capability: 'text' }] }),
      strict,
      ['grounding.no_upload_source'],
    ],
    ['non-strict without upload source', grounded({ sources: [{ kind: 'model', capability: 'text' }] }), mixed, []],
    ['unknown segment', grounded({ sources: [upload('s9', 2)] }), mixed, ['grounding.unknown_segment']],
    ['wrong page', grounded({ sources: [upload('s3', 1)] }), mixed, ['grounding.unknown_segment']],
    [
      'wrong study set',
      grounded({ sources: [upload('s3', 2, undefined, '00000000-0000-4000-8000-000000000099')] }),
      mixed,
      ['grounding.unknown_segment'],
    ],
    [
      'excerpt not in segment',
      grounded({ sources: [upload('s3', 2, 'bildar snö')] }),
      mixed,
      ['grounding.excerpt_not_in_source'],
    ],
    ['excerpt with ellipsis', grounded({ sources: [upload('s3', 2, 'Vattenångan kyls … bildar moln')] }), mixed, []],
    ['excerpt case/space-insensitive', grounded({ sources: [upload('s3', 2, 'BILDAR   moln')] }), mixed, []],
    ['unsupported, strict → error', grounded(offTopic), strict, ['grounding.unsupported']],
    ['unsupported, sourceAndCurriculum → warning', grounded(offTopic), mixed, ['grounding.unsupported']],
    ['unsupported, extended → warning', grounded(offTopic), extended, ['grounding.unsupported']],
    ['no material, uploads cited', grounded(), ctx({ sourceMode: 'strict' }), []],
  ])('%s', (_n, i, c, want) => expect(codes(grounding(i, c))).toEqual(want))

  it('severity follows source mode', () => {
    const i = grounded(offTopic)
    expect(grounding(i, strict)[0]!.severity).toBe('error')
    expect(grounding(i, mixed)[0]!.severity).toBe('warning')
    expect(grounding(i, extended)[0]!.severity).toBe('warning')
  })
  it('excerpt over 300 chars', () => {
    const i = { ...grounded(), sources: [{ ...upload('s3', 2), excerpt: 'x'.repeat(301) }] } as Item
    expect(codes(grounding(i, mixed))).toEqual(['grounding.excerpt_too_long'])
  })
  it('uses the definition segment for vocabulary', () => {
    const i = item('fillBlank', {
      prompt: 'Fyll i ordet.',
      text: '___ betyder att vatten blir till gas.',
      blanks: [{ accepted: ['Avdunstning'] }],
      sources: [upload('s2', 1, 'Avdunstning betyder')],
    })
    expect(grounding(i, strict)).toEqual([])
    expect(SET).toBe(MATERIAL.studySetId)
  })
})

describe('text helpers', () => {
  it.each([
    ['Vad är det för djur som säger mjau?', 'sv'],
    ['What is the name of the animal that says meow?', 'en'],
    ['Hund', undefined],
    ['Översätt: The cat', undefined],
  ])('detectLanguage(%j) = %s', (s, want) => expect(detectLanguage(s)).toBe(want))
  it.each([
    ['bildar', 'bildas'],
    ['katten', 'katter'],
    ['vattnet', 'vattnets'],
  ])('stem(%s) = stem(%s)', (a, b) => expect(stem(a)).toBe(stem(b)))
  it('containsWords matches whole words only', () => {
    expect(containsWords('En katt.', 'Katt')).toBe(true)
    expect(containsWords('Katten.', 'katt')).toBe(false)
    expect(containsWords('a (b) c', '(b)')).toBe(true)
  })
  it('keyTerms drops stopwords, generic words and numbers', () => {
    expect(keyTerms('Välj rätt svar: hur många moln finns det 2025?')).toEqual(['moln'])
  })
})
