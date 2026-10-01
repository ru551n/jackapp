import type { Generator } from '../../core/types'
import { nameTheKind, oddOneOut, railOrAir } from './category'
import { carriageNumberOrder, trainLengthOrder, tramRouteQuestion, tramStopsOrder } from './order'
import { colourUnitPattern, tramColourPattern, vehicleTypePattern } from './pattern'

export const LOGIC_GENERATORS: Generator[] = [
  tramColourPattern,
  vehicleTypePattern,
  colourUnitPattern,
  trainLengthOrder,
  tramStopsOrder,
  carriageNumberOrder,
  tramRouteQuestion,
  oddOneOut,
  railOrAir,
  nameTheKind,
]
