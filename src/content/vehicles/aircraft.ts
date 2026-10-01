import type { Vehicle } from '../../core/types'

// Civilian and fighter aircraft. Facts must be verified; list sources.
export const AIRCRAFT: Vehicle[] = [
  {
    id: 'gripen',
    name: 'Saab JAS 39 Gripen',
    shortName: 'Gripen',
    category: 'fighter',
    country: 'Sverige',
    swedish: true,
    facts: [
      'Gripen är ett svenskt stridsflygplan från Saab.',
      'Gripen har en motor.',
      'Gripen kan landa på vanliga vägar.',
    ],
    specs: { firstYear: 1988, engines: 1 },
    sources: ['https://sv.wikipedia.org/wiki/Saab_39_Gripen'],
    unlock: { area: 'flygplatsen', missions: 1 },
  },
]
