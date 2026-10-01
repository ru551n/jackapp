import type { Vehicle } from '../../core/types'

// Trains, metro and trams. Facts must be verified; list sources.
export const RAIL_VEHICLES: Vehicle[] = [
  {
    id: 'x2000',
    name: 'X2000',
    shortName: 'X2000',
    category: 'train',
    country: 'Sverige',
    swedish: true,
    facts: [
      'X2000 är ett svenskt snabbtåg.',
      'Tåget lutar i kurvorna så att det kan köra fort.',
      'Det kan köra 200 kilometer i timmen.',
    ],
    specs: { firstYear: 1990, topSpeedKmh: 200 },
    sources: ['https://sv.wikipedia.org/wiki/X2000'],
    unlock: { area: 'any', missions: 1 },
  },
]
