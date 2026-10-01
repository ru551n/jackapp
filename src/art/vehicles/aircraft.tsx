import type { ComponentType } from 'react'
import type { VehicleArtProps } from './types'

// Original top-view (planform) drawings, nose up, centred on x=50. Half-shapes are given for the right
// side only and mirrored, so every aircraft is symmetric. Size is normalised per drawing (not to scale).
type Pt = [number, number]
const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(' ')
const mirror = (p: Pt[]): Pt[] => p.map(([x, y]) => [100 - x, y])

interface Def {
  name: string
  airliner?: boolean
  /** Fuselage half-profile as [dx from centre, y], nose first (dx 0). */
  body: Pt[]
  /** Right-half wing / canard / tailplane polygons in absolute coordinates. */
  wings: Pt[][]
  /** Engines or nozzles [dx, y, rx, ry]; dx 0 = centreline, otherwise mirrored. */
  engines: [number, number, number, number][]
  /** Vertical fins seen from above as slim bars [dx, y1, y2]; dx 0 = centreline, otherwise mirrored. */
  fins?: [number, number, number][]
}

const bodyPoly = (half: Pt[]): Pt[] => [
  ...half.map(([d, y]): Pt => [50 + d, y]),
  ...[...half].reverse().map(([d, y]): Pt => [50 - d, y]),
]

function Planform({ def, mode = 'color', className }: { def: Def } & VehicleArtProps) {
  // Silhouette = one fill, but the identifying parts (engines, props, fins, canards) stay in it.
  const sil = mode === 'silhouette'
  const wing = sil ? 'var(--ink)' : 'var(--tint-grey)'
  const body = sil ? 'var(--ink)' : def.airliner ? 'var(--paper)' : 'var(--ink-soft)'
  const eng = sil || !def.airliner ? 'var(--ink)' : 'var(--ink-soft)'
  const sides = (dx: number): number[] => (dx === 0 ? [50] : [50 + dx, 50 - dx])
  const stroke = sil ? 'var(--ink)' : 'var(--ink-soft)'
  const off = def.engines.filter(([dx]) => dx !== 0)
  const centre = def.engines.filter(([dx]) => dx === 0)
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={def.name} className={className} strokeLinejoin="round">
      {def.wings.flatMap((w, i) =>
        [w, mirror(w)].map((p, j) => (
          <polygon key={`w${i}${j}`} points={pts(p)} fill={wing} stroke={wing} strokeWidth="1" />
        )),
      )}
      {off.flatMap(([dx, y, rx, ry], i) =>
        sides(dx).map((x, j) => <ellipse key={`e${i}${j}`} cx={x} cy={y} rx={rx} ry={ry} fill={eng} />),
      )}
      <polygon points={pts(bodyPoly(def.body))} fill={body} stroke={stroke} strokeWidth={sil ? 1 : 0.8} />
      {def.fins?.flatMap(([dx, y1, y2], i) =>
        sides(dx).map((x, j) => (
          <line
            key={`f${i}${j}`}
            x1={x}
            y1={y1}
            x2={x}
            y2={y2}
            stroke="var(--ink)"
            strokeWidth="2.6"
            strokeLinecap="butt"
          />
        )),
      )}
      {centre.map(([, y, rx, ry], i) => (
        <ellipse key={`c${i}`} cx={50} cy={y} rx={rx} ry={ry} fill="var(--ink)" />
      ))}
      {!sil &&
        (def.airliner ? (
          <line
            x1="50"
            y1={def.body[1][1] + 1}
            x2="50"
            y2={def.body[def.body.length - 3][1]}
            stroke="var(--window)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <ellipse cx="50" cy={def.body[2][1] + 3} rx="1.6" ry="4" fill="var(--window)" />
        ))}
    </svg>
  )
}

/** `tail` = half-width where the body ends, so twin nozzles stick out past a narrow tail. */
const fighterBody = (w: number, intake = 0, tail = w - 2): Pt[] => [
  [0, 3],
  [1.5, 10],
  [2.5, 22],
  [w - 1 + intake, 40],
  [w + intake, 52],
  [w, 70],
  [w - 1, 88],
  [tail, 95],
]

const DEFS: Record<string, Def> = {
  gripen: {
    name: 'Gripen',
    body: fighterBody(3.5),
    wings: [
      [
        [53, 52],
        [78, 86],
        [78, 92],
        [53, 92],
      ],
      [
        [53, 30],
        [63, 38],
        [63, 42],
        [53, 41],
      ],
    ],
    engines: [[0, 96, 2.4, 3]],
    fins: [[0, 76, 94]],
  },
  draken: {
    name: 'Draken',
    body: fighterBody(3.3),
    // Double delta: the inner leading edge runs almost along the body, then kinks out sharply.
    wings: [
      [
        [53, 40],
        [57, 62],
        [80, 80],
        [80, 91],
        [53, 91],
      ],
    ],
    engines: [[0, 96, 2.4, 3]],
    fins: [[0, 78, 94]],
  },
  viggen: {
    name: 'Viggen',
    body: fighterBody(4.2),
    wings: [
      [
        [53, 58],
        [86, 90],
        [86, 95],
        [53, 95],
      ],
      [
        [53, 28],
        [76, 46],
        [76, 53],
        [53, 52],
      ],
    ],
    engines: [[0, 96, 2.6, 3]],
    fins: [[0, 76, 94]],
  },
  f16: {
    name: 'F-16',
    body: fighterBody(3.5, 1.2),
    wings: [
      [
        [53, 52],
        [80, 70],
        [80, 78],
        [53, 80],
      ],
      [
        [53, 84],
        [67, 92],
        [67, 96],
        [53, 95],
      ],
      [
        [52, 30],
        [59, 48],
        [53, 50],
      ],
    ],
    engines: [[0, 96, 2.6, 3]],
    fins: [[0, 78, 94]],
  },
  fa18: {
    name: 'F/A-18',
    body: fighterBody(4.5, 0.5, 1.6),
    // Long strakes (pointed wing extensions) run from the wing roots up towards the cockpit.
    wings: [
      [
        [54, 48],
        [82, 66],
        [82, 76],
        [54, 80],
      ],
      [
        [53, 24],
        [60, 44],
        [54, 50],
      ],
      [
        [54, 82],
        [67, 89],
        [67, 92],
        [54, 92],
      ],
    ],
    engines: [[3.6, 95.5, 3, 5]],
    fins: [[7, 72, 98]],
  },
  f15: {
    name: 'F-15',
    body: fighterBody(5.8, 0, 1.6),
    wings: [
      [
        [55, 44],
        [84, 70],
        [84, 84],
        [55, 86],
      ],
      [
        [55, 88],
        [67, 93],
        [67, 96],
        [55, 96],
      ],
    ],
    engines: [[4.8, 95.5, 3.6, 5]],
    fins: [[9.5, 72, 99]],
  },
  typhoon: {
    name: 'Typhoon',
    body: fighterBody(4.5, 0.5, 1.6),
    wings: [
      [
        [54, 52],
        [80, 86],
        [80, 91],
        [54, 91],
      ],
      [
        [53, 24],
        [68, 34],
        [68, 38],
        [53, 36],
      ],
    ],
    engines: [[3.6, 95.5, 3, 5]],
    fins: [[0, 78, 94]],
  },
  rafale: {
    name: 'Rafale',
    body: fighterBody(4.5, 0.8, 1.6),
    wings: [
      [
        [54, 50],
        [76, 78],
        [78, 88],
        [60, 91],
        [54, 91],
      ],
      [
        [54, 40],
        [64, 48],
        [64, 50],
        [54, 50],
      ],
    ],
    engines: [[3.6, 95.5, 3, 5]],
    fins: [[0, 78, 94]],
  },
  a320: {
    name: 'Airbus A320',
    airliner: true,
    body: [
      [0, 3],
      [2.5, 7],
      [4, 15],
      [4, 70],
      [2.5, 88],
      [1.2, 96],
      [0, 97],
    ],
    // Strongly swept wings with small upturned tips (sharklets) and slim engines far out.
    wings: [
      [
        [54, 34],
        [92, 66],
        [92, 71],
        [54, 54],
      ],
      [
        [53, 82],
        [74, 92],
        [74, 96],
        [53, 92],
      ],
    ],
    engines: [[21, 48, 2.6, 6]],
  },
  b737: {
    name: 'Boeing 737',
    airliner: true,
    body: [
      [0, 8],
      [3, 12],
      [4.6, 20],
      [4.6, 70],
      [2.8, 86],
      [1.4, 95],
      [0, 96],
    ],
    // Straighter wings, short tailplane, and fat engines close in that stick out ahead of the wing.
    wings: [
      [
        [55, 46],
        [88, 60],
        [88, 68],
        [55, 62],
      ],
      [
        [53, 84],
        [64, 90],
        [64, 94],
        [53, 92],
      ],
    ],
    engines: [[12, 48, 4, 8]],
  },
  a380: {
    name: 'Airbus A380',
    airliner: true,
    body: [
      [0, 7],
      [3.5, 12],
      [5.5, 22],
      [5.5, 72],
      [3, 88],
      [1.5, 93],
      [0, 94],
    ],
    wings: [
      [
        [55, 36],
        [97, 60],
        [97, 66],
        [55, 56],
      ],
      [
        [54, 82],
        [74, 90],
        [74, 94],
        [54, 91],
      ],
    ],
    engines: [
      [14, 42, 3, 6],
      [30, 50, 3, 6],
    ],
  },
  saab340: {
    name: 'Saab 340',
    airliner: true,
    body: [
      [0, 7],
      [2.5, 11],
      [3.5, 18],
      [3.5, 74],
      [2.2, 88],
      [1, 93],
      [0, 94],
    ],
    wings: [
      [
        [53, 38],
        [97, 42],
        [97, 50],
        [53, 52],
      ],
      [
        [53, 82],
        [68, 85],
        [68, 91],
        [53, 91],
      ],
    ],
    // propeller discs drawn as a thin bar via the engine ellipse's width
    engines: [
      [18, 34, 2.4, 9],
      [18, 22, 7, 0.9],
    ],
  },
}

/** Original aircraft illustrations keyed by vehicle id (owned by the aviation track). */
export const AIRCRAFT_ART: Record<string, ComponentType<VehicleArtProps>> = Object.fromEntries(
  Object.entries(DEFS).map(([id, def]) => [id, (props: VehicleArtProps) => <Planform def={def} {...props} />]),
)
