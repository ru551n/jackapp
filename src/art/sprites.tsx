import type { ReactElement } from 'react'
import type { SpriteId, Tint } from '../core/types'

// Original, simplified side-view sprites. Colours come from CSS tokens so themes stay consistent.
const tintVar = (tint: Tint | undefined, fallback: string) => (tint ? `var(--tint-${tint})` : fallback)

type Draw = (fill: string) => ReactElement
interface SpriteDef {
  viewBox: string
  /** Relative width so rows of mixed sprites line up sensibly. */
  width: number
  defaultFill: string
  draw: Draw
}

const wheels = (xs: number[], y: number) => xs.map((x) => <circle key={x} cx={x} cy={y} r={5} fill="var(--ink)" />)

const SPRITES: Record<SpriteId, SpriteDef> = {
  locomotive: {
    viewBox: '0 0 100 60',
    width: 1.4,
    defaultFill: 'var(--tint-red)',
    draw: (fill) => (
      <>
        <path d="M6 14 h66 q20 0 24 26 v8 H6 z" fill={fill} />
        <path d="M72 18 h8 q10 2 13 18 H72 z" fill="var(--window)" />
        <rect x="14" y="20" width="14" height="12" rx="2" fill="var(--window)" />
        <rect x="34" y="20" width="14" height="12" rx="2" fill="var(--window)" />
        <rect x="6" y="40" width="90" height="3" fill="var(--ink-soft)" opacity=".35" />
        {wheels([20, 36, 66, 82], 52)}
      </>
    ),
  },
  carriage: {
    viewBox: '0 0 100 60',
    width: 1.4,
    defaultFill: 'var(--tint-blue)',
    draw: (fill) => (
      <>
        <rect x="4" y="12" width="92" height="36" rx="6" fill={fill} />
        {[12, 32, 52, 72].map((x) => (
          <rect key={x} x={x} y="19" width="14" height="12" rx="2" fill="var(--window)" />
        ))}
        {wheels([18, 32, 68, 82], 52)}
      </>
    ),
  },
  metroCar: {
    viewBox: '0 0 100 60',
    width: 1.4,
    defaultFill: 'var(--tint-blue)',
    draw: (fill) => (
      <>
        <rect x="4" y="10" width="92" height="40" rx="8" fill={fill} />
        <rect x="4" y="38" width="92" height="4" fill="var(--paper)" opacity=".7" />
        {[22, 62].map((x) => (
          <rect
            key={x}
            x={x}
            y="16"
            width="16"
            height="30"
            rx="2"
            fill="var(--window)"
            stroke="var(--ink-soft)"
            strokeWidth="1"
          />
        ))}
        <rect x="10" y="17" width="8" height="12" rx="2" fill="var(--window)" />
        <rect x="42" y="17" width="16" height="12" rx="2" fill="var(--window)" />
        <rect x="82" y="17" width="8" height="12" rx="2" fill="var(--window)" />
        {wheels([20, 80], 54)}
      </>
    ),
  },
  tram: {
    viewBox: '0 0 100 64',
    width: 1.5,
    defaultFill: 'var(--tint-blue)',
    draw: (fill) => (
      <>
        <path d="M40 4 l10 8 l10 -8" stroke="var(--ink)" strokeWidth="2" fill="none" />
        <rect x="4" y="12" width="92" height="40" rx="10" fill={fill} />
        <rect x="4" y="40" width="92" height="5" fill="var(--paper)" opacity=".7" />
        {[12, 30, 54, 72].map((x) => (
          <rect key={x} x={x} y="19" width="14" height="15" rx="3" fill="var(--window)" />
        ))}
        {wheels([22, 78], 56)}
      </>
    ),
  },
  passenger: {
    viewBox: '0 0 40 60',
    width: 0.6,
    defaultFill: 'var(--tint-green)',
    draw: (fill) => (
      <>
        <circle cx="20" cy="12" r="9" fill="var(--skin)" />
        <path d="M6 58 v-22 q0 -14 14 -14 q14 0 14 14 v22 z" fill={fill} />
      </>
    ),
  },
  suitcase: {
    viewBox: '0 0 40 50',
    width: 0.6,
    defaultFill: 'var(--tint-yellow)',
    draw: (fill) => (
      <>
        <path d="M14 14 v-6 h12 v6" stroke="var(--ink)" strokeWidth="3" fill="none" />
        <rect x="4" y="14" width="32" height="30" rx="5" fill={fill} />
        <rect x="12" y="14" width="3" height="30" fill="var(--ink-soft)" opacity=".4" />
        <rect x="25" y="14" width="3" height="30" fill="var(--ink-soft)" opacity=".4" />
        <circle cx="11" cy="46" r="3" fill="var(--ink)" />
        <circle cx="29" cy="46" r="3" fill="var(--ink)" />
      </>
    ),
  },
  airliner: {
    viewBox: '0 0 120 50',
    width: 1.7,
    defaultFill: 'var(--paper-strong)',
    draw: (fill) => (
      <>
        <path d="M8 16 l8 0 l10 12 z" fill="var(--tint-blue)" />
        <path
          d="M6 26 q0 -6 10 -6 h80 q18 0 22 8 q-4 6 -22 6 h-80 q-10 0 -10 -8 z"
          fill={fill}
          stroke="var(--ink-soft)"
          strokeWidth="1.5"
        />
        <path d="M50 30 l22 0 l-14 14 h-8 z" fill="var(--tint-blue)" />
        {[30, 38, 46, 54, 62, 70, 78, 86].map((x) => (
          <circle key={x} cx={x} cy="25" r="1.8" fill="var(--ink-soft)" />
        ))}
        <path d="M104 22 q6 2 9 5 h-9 z" fill="var(--ink-soft)" />
      </>
    ),
  },
  jet: {
    viewBox: '0 0 60 60',
    width: 1,
    defaultFill: 'var(--tint-grey)',
    draw: (fill) => (
      <>
        <path
          d="M30 2 q4 6 4 18 l22 22 v6 l-22 -6 l-1 10 l8 6 v3 h-22 v-3 l8 -6 l-1 -10 l-22 6 v-6 l22 -22 q0 -12 4 -18 z"
          fill={fill}
        />
        <ellipse cx="30" cy="14" rx="2.5" ry="5" fill="var(--window)" />
      </>
    ),
  },
  signal: {
    viewBox: '0 0 30 70',
    width: 0.45,
    defaultFill: 'var(--tint-green)',
    draw: (fill) => (
      <>
        <rect x="13" y="30" width="4" height="38" fill="var(--ink-soft)" />
        <rect x="5" y="2" width="20" height="34" rx="6" fill="var(--ink)" />
        <circle cx="15" cy="12" r="6" fill="var(--ink-soft)" opacity=".5" />
        <circle cx="15" cy="26" r="6" fill={fill} />
      </>
    ),
  },
  station: {
    viewBox: '0 0 100 60',
    width: 1.4,
    defaultFill: 'var(--tint-yellow)',
    draw: (fill) => (
      <>
        <path d="M10 26 l40 -18 l40 18 z" fill="var(--ink-soft)" />
        <rect x="16" y="26" width="68" height="28" fill={fill} />
        <rect x="44" y="34" width="12" height="20" fill="var(--ink-soft)" />
        <rect x="24" y="32" width="12" height="10" fill="var(--window)" />
        <rect x="64" y="32" width="12" height="10" fill="var(--window)" />
        <rect x="4" y="54" width="92" height="4" fill="var(--ink)" />
      </>
    ),
  },
}

export function Sprite({
  id,
  tint,
  className,
  title,
}: {
  id: SpriteId
  tint?: Tint
  className?: string
  title?: string
}) {
  const def = SPRITES[id]
  return (
    <svg
      viewBox={def.viewBox}
      className={className}
      style={{ ['--sprite-w' as string]: def.width }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {def.draw(tintVar(tint, def.defaultFill))}
    </svg>
  )
}
