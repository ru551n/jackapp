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
  const sil = mode === 'silhouette'
  const wing = sil ? 'var(--ink)' : 'var(--tint-grey)'
  const body = sil ? 'var(--ink)' : def.airliner ? 'var(--paper)' : 'var(--ink-soft)'
  const eng = sil ? 'var(--ink)' : 'var(--ink-soft)'
  const sides = (dx: number): number[] => (dx === 0 ? [50] : [50 + dx, 50 - dx])
  const stroke = sil ? 'var(--ink)' : 'var(--ink-soft)'
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={def.name} className={className} strokeLinejoin="round">
      {def.wings.flatMap((w, i) =>
        [w, mirror(w)].map((p, j) => (
          <polygon key={`w${i}${j}`} points={pts(p)} fill={wing} stroke={wing} strokeWidth="1" />
        )),
      )}
      {!sil &&
        def.engines.flatMap(([dx, y, rx, ry], i) =>
          dx === 0
            ? []
            : sides(dx).map((x, j) => <ellipse key={`e${i}${j}`} cx={x} cy={y} rx={rx} ry={ry} fill={eng} />),
        )}
      <polygon points={pts(bodyPoly(def.body))} fill={body} stroke={stroke} strokeWidth={sil ? 1 : 0.8} />
      {!sil && (
        <>
          {def.fins?.flatMap(([dx, y1, y2], i) =>
            sides(dx).map((x, j) => (
              <line
                key={`f${i}${j}`}
                x1={x}
                y1={y1}
                x2={x}
                y2={y2}
                stroke="var(--ink)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )),
          )}
          {def.engines
            .filter(([dx]) => dx === 0)
            .map(([, y, rx, ry], i) => (
              <ellipse key={`c${i}`} cx={50} cy={y} rx={rx} ry={ry} fill="var(--ink)" />
            ))}
          {def.airliner ? (
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
          )}
        </>
      )}
    </svg>
  )
}

const fighterBody = (w: number, intake = 0): Pt[] => [
  [0, 3],
  [1.5, 10],
  [2.5, 22],
  [w - 1 + intake, 40],
  [w + intake, 52],
  [w, 70],
  [w - 1, 88],
  [w - 2, 97],
]

const DEFS: Record<string, Def> = {
  gripen: {
    name: 'Gripen',
    body: fighterBody(3.5),
    wings: [
      [
        [53, 48],
        [78, 84],
        [78, 91],
        [53, 91],
      ],
      [
        [53, 28],
        [64, 40],
        [64, 44],
        [53, 42],
      ],
    ],
    engines: [[0, 95, 2.2, 2.2]],
    fins: [[0, 76, 94]],
  },
  draken: {
    name: 'Draken',
    body: fighterBody(3.3),
    wings: [
      [
        [53, 36],
        [60, 60],
        [74, 84],
        [74, 91],
        [53, 91],
      ],
    ],
    engines: [[0, 96, 2.2, 2.2]],
    fins: [[0, 78, 94]],
  },
  viggen: {
    name: 'Viggen',
    body: fighterBody(4),
    wings: [
      [
        [53, 54],
        [82, 88],
        [82, 94],
        [53, 94],
      ],
      [
        [53, 30],
        [72, 46],
        [72, 51],
        [53, 49],
      ],
    ],
    engines: [[0, 96, 2.4, 2.2]],
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
    engines: [[0, 96, 2.4, 2.2]],
    fins: [[0, 78, 94]],
  },
  fa18: {
    name: 'F/A-18',
    body: fighterBody(4.5, 0.5),
    wings: [
      [
        [54, 48],
        [82, 66],
        [82, 76],
        [54, 80],
      ],
      [
        [53, 28],
        [59, 46],
        [54, 48],
      ],
      [
        [54, 82],
        [69, 91],
        [69, 95],
        [54, 95],
      ],
    ],
    engines: [[2.2, 96, 2, 2]],
    fins: [[5.5, 72, 90]],
  },
  f15: {
    name: 'F-15',
    body: fighterBody(5.5),
    wings: [
      [
        [55, 44],
        [82, 72],
        [82, 84],
        [55, 86],
      ],
      [
        [55, 86],
        [69, 92],
        [69, 96],
        [55, 96],
      ],
    ],
    engines: [[3, 97, 2.4, 2.2]],
    fins: [[8, 72, 94]],
  },
  typhoon: {
    name: 'Typhoon',
    body: fighterBody(4.5, 0.5),
    wings: [
      [
        [54, 50],
        [79, 84],
        [79, 91],
        [54, 91],
      ],
      [
        [53, 26],
        [66, 38],
        [66, 42],
        [53, 40],
      ],
    ],
    engines: [[2.2, 97, 2, 2]],
    fins: [[0, 78, 94]],
  },
  rafale: {
    name: 'Rafale',
    body: fighterBody(4.5, 0.8),
    wings: [
      [
        [54, 48],
        [80, 82],
        [80, 89],
        [64, 91],
        [54, 91],
      ],
      [
        [54, 40],
        [66, 48],
        [66, 52],
        [54, 50],
      ],
    ],
    engines: [[2.2, 97, 2, 2]],
    fins: [[0, 78, 94]],
  },
  a320: {
    name: 'Airbus A320',
    airliner: true,
    body: [
      [0, 4],
      [2.5, 8],
      [4, 16],
      [4, 70],
      [2.5, 88],
      [1.2, 96],
      [0, 97],
    ],
    wings: [
      [
        [54, 36],
        [94, 62],
        [94, 67],
        [54, 54],
      ],
      [
        [53, 82],
        [72, 91],
        [72, 95],
        [53, 92],
      ],
    ],
    engines: [[18, 44, 2.6, 5.5]],
  },
  b737: {
    name: 'Boeing 737',
    airliner: true,
    body: [
      [0, 4],
      [2.5, 8],
      [4, 16],
      [4, 70],
      [2.5, 88],
      [1.2, 96],
      [0, 97],
    ],
    wings: [
      [
        [54, 38],
        [91, 62],
        [91, 67],
        [54, 55],
      ],
      [
        [53, 82],
        [70, 91],
        [70, 95],
        [53, 92],
      ],
    ],
    engines: [[16, 46, 2.8, 5]],
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
      [14, 42, 2.4, 5],
      [30, 50, 2.4, 5],
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
