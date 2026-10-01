import type { ComponentType, ReactNode } from 'react'
import type { VehicleArtProps } from './types'

/** Original, simplified side views of Swedish trains, metro and trams (owned by the collection track). */

type Mode = NonNullable<VehicleArtProps['mode']>
// In silhouette mode everything collapses to one fill; in colour mode `c` is used.
const fill = (mode: Mode, c: string) => (mode === 'silhouette' ? 'var(--ink)' : c)
const edge = (mode: Mode) => (mode === 'silhouette' ? undefined : 'var(--ink-soft)')

function Frame({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 300 100" role="img" aria-label={label} className={className}>
      <rect x="0" y="91" width="300" height="3" rx="1.5" fill="var(--ink)" opacity=".35" />
      {children}
    </svg>
  )
}

const Wheels = ({ xs, y = 85, r = 5 }: { xs: number[]; y?: number; r?: number }) => (
  <>
    {xs.map((x) => (
      <circle key={x} cx={x} cy={y} r={r} fill="var(--ink)" />
    ))}
  </>
)

const Windows = ({ mode, xs, y, w, h }: { mode: Mode; xs: number[]; y: number; w: number; h: number }) => (
  <>
    {xs.map((x) => (
      <rect key={x} x={x} y={y} width={w} height={h} rx="2" fill={fill(mode, 'var(--window)')} />
    ))}
  </>
)

const range = (from: number, step: number, n: number) => Array.from({ length: n }, (_, i) => from + i * step)

const Pantograph = ({ x, y, mode }: { x: number; y: number; mode: Mode }) => (
  <g stroke={fill(mode, 'var(--ink)')} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={`${x - 16},${y} ${x},${y - 20} ${x + 16},${y}`} />
    <line x1={x - 10} y1={y - 20} x2={x + 10} y2={y - 20} />
  </g>
)

type ArtProps = VehicleArtProps
const make =
  (label: string, draw: (mode: Mode) => ReactNode): ComponentType<ArtProps> =>
  ({ mode = 'color', className }) => (
    <Frame label={label} className={className}>
      {draw(mode)}
    </Frame>
  )

// X2000: a coach and a power car with the long, sloping nose; light body with a blue stripe.
const X2000 = make('X2000, ett svenskt snabbtåg', (m) => (
  <>
    <rect
      x="8"
      y="34"
      width="138"
      height="48"
      rx="6"
      fill={fill(m, 'var(--paper-strong)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <path
      d="M152 34 H236 Q270 36 289 68 V82 H152 Z"
      fill={fill(m, 'var(--paper-strong)')}
      stroke={edge(m)}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <rect x="8" y="62" width="138" height="6" fill={fill(m, 'var(--tint-blue)')} />
    <path d="M152 62 H281 L283 68 H152 Z" fill={fill(m, 'var(--tint-blue)')} />
    <Windows mode={m} xs={range(18, 18, 7)} y={42} w={12} h={11} />
    <Windows mode={m} xs={range(160, 18, 4)} y={42} w={12} h={11} />
    <path d="M240 41 Q262 42 276 58 H240 Z" fill={fill(m, 'var(--window)')} />
    <Wheels xs={[28, 48, 108, 128, 172, 192, 250, 270]} />
  </>
))

// Regina: three joined cars with softly rounded ends and a big rounded windscreen.
const Regina = make('Regina, ett svenskt tåg', (m) => (
  <>
    <rect
      x="8"
      y="32"
      width="284"
      height="50"
      rx="24"
      fill={fill(m, 'var(--paper-strong)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <path d="M30 66 H270 V76 Q270 82 262 82 H38 Q30 82 30 76 Z" fill={fill(m, 'var(--tint-red)')} />
    <Windows mode={m} xs={[40, 62, 84, 114, 136, 158, 180, 210, 232]} y={42} w={16} h={12} />
    <rect x="262" y="38" width="22" height="18" rx="9" fill={fill(m, 'var(--window)')} />
    <g stroke={fill(m, 'var(--ink-soft)')} strokeWidth="1.5">
      <line x1="104" y1="34" x2="104" y2="80" />
      <line x1="200" y1="34" x2="200" y2="80" />
    </g>
    <Wheels xs={[44, 64, 140, 160, 236, 256]} />
  </>
))

// X60 commuter train: tall blue body, light band, sloped end windows.
const X60 = make('SL pendeltåg X60', (m) => (
  <>
    <path
      d="M8 40 Q8 28 22 28 H278 Q292 28 292 40 V82 H8 Z"
      fill={fill(m, 'var(--tint-blue)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <rect x="8" y="58" width="284" height="8" fill={fill(m, 'var(--paper)')} />
    <Windows mode={m} xs={range(34, 22, 11)} y={36} w={14} h={14} />
    <g stroke={fill(m, 'var(--paper)')} strokeWidth="2">
      <line x1="95" y1="30" x2="95" y2="80" />
      <line x1="184" y1="30" x2="184" y2="80" />
    </g>
    <Wheels xs={[30, 50, 140, 160, 250, 270]} />
  </>
))

// Öresundståg: streamlined unit with slanted noses at both ends.
const X31 = make('Öresundståg X31', (m) => (
  <>
    <path
      d="M8 82 V62 Q16 36 48 34 H252 Q284 36 292 62 V82 Z"
      fill={fill(m, 'var(--tint-grey)')}
      stroke={edge(m)}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 62 Q9 56 12 52 H288 Q291 56 292 62 Z" fill={fill(m, 'var(--paper-strong)')} />
    <rect x="8" y="64" width="284" height="6" fill={fill(m, 'var(--tint-green)')} />
    <Windows mode={m} xs={range(50, 24, 9)} y={40} w={16} h={11} />
    <path d="M254 40 Q276 42 284 54 H254 Z M46 40 Q24 42 16 54 H46 Z" fill={fill(m, 'var(--window)')} />
    <Wheels xs={[40, 60, 140, 160, 240, 260]} />
  </>
))

// Rc6: boxy electric locomotive with a pantograph on the roof.
const Rc6 = make('Rc6, ett ellok', (m) => (
  <>
    <Pantograph x={150} y={34} mode={m} />
    <path
      d="M44 82 V46 Q44 34 58 34 H242 Q256 34 256 46 V82 Z"
      fill={fill(m, 'var(--tint-red)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <rect x="44" y="62" width="212" height="6" fill={fill(m, 'var(--paper)')} />
    <Windows mode={m} xs={[52, 226]} y={40} w={22} h={16} />
    <Windows mode={m} xs={[130, 150, 170]} y={42} w={12} h={10} />
    <g stroke={fill(m, 'var(--paper)')} strokeWidth="2" opacity=".7">
      <line x1="90" y1="42" x2="110" y2="42" />
      <line x1="90" y1="48" x2="110" y2="48" />
      <line x1="190" y1="42" x2="210" y2="42" />
      <line x1="190" y1="48" x2="210" y2="48" />
    </g>
    <Wheels xs={[70, 100, 200, 230]} r={6} />
  </>
))

// IORE: two heavy locomotive sections coupled back to back, a cab at each outer end.
const Iore = make('Malmlok IORE', (m) => (
  <>
    <path d="M8 82 V44 Q8 28 24 28 H146 V82 Z" fill={fill(m, 'var(--tint-blue)')} stroke={edge(m)} strokeWidth="1.5" />
    <path
      d="M292 82 V44 Q292 28 276 28 H154 V82 Z"
      fill={fill(m, 'var(--tint-blue)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <rect x="8" y="64" width="138" height="7" fill={fill(m, 'var(--tint-yellow)')} />
    <rect x="154" y="64" width="138" height="7" fill={fill(m, 'var(--tint-yellow)')} />
    <Windows mode={m} xs={[14, 262]} y={34} w={24} h={18} />
    <Windows mode={m} xs={[60, 86, 112, 168, 194, 220]} y={38} w={14} h={10} />
    <rect x="146" y="66" width="8" height="5" fill="var(--ink)" />
    <Wheels xs={[28, 52, 76, 100, 124, 176, 200, 224, 248, 272]} r={6} />
  </>
))

// C20: silver (stainless steel) metro train with a blue stripe, three cars with light doors.
const C20 = make('Tunnelbanetåg C20', (m) => (
  <>
    <rect x="8" y="30" width="284" height="52" rx="14" fill={fill(m, '#c9d1d9')} stroke={edge(m)} strokeWidth="1.5" />
    <rect x="8" y="66" width="284" height="8" fill={fill(m, 'var(--tint-blue)')} />
    {range(40, 40, 6).map((x) => (
      <rect key={x} x={x} y="38" width="12" height="28" rx="2" fill={fill(m, 'var(--paper)')} />
    ))}
    <Windows mode={m} xs={range(56, 40, 6)} y={40} w={12} h={14} />
    <rect x="270" y="38" width="16" height="18" rx="5" fill={fill(m, 'var(--window)')} />
    <g stroke={fill(m, 'var(--ink-soft)')} strokeWidth="2">
      <line x1="94" y1="32" x2="94" y2="80" />
      <line x1="196" y1="32" x2="196" y2="80" />
    </g>
    <Wheels xs={[34, 54, 150, 170, 246, 266]} r={4.5} />
  </>
))

// C30: newer metro train with a wide continuous window band and a sloped, rounded front.
const C30 = make('Tunnelbanetåg C30', (m) => (
  <>
    <path
      d="M8 82 V44 Q8 30 24 30 H236 Q272 32 290 60 V82 Z"
      fill={fill(m, 'var(--paper-strong)')}
      stroke={edge(m)}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 64 H288 L290 82 H8 Z" fill={fill(m, 'var(--tint-blue)')} />
    <rect x="16" y="38" width="226" height="16" rx="6" fill={fill(m, 'var(--window)')} />
    <path d="M248 38 Q268 40 280 56 H248 Z" fill={fill(m, 'var(--window)')} />
    <g stroke={fill(m, 'var(--ink-soft)')} strokeWidth="1.5">
      {range(70, 56, 4).map((x) => (
        <line key={x} x1={x} y1="38" x2={x} y2="54" />
      ))}
    </g>
    <Wheels xs={[40, 60, 150, 170, 244, 264]} r={4.5} />
  </>
))

// M32: long, low-floor tram, three sections, pantograph on the roof.
const M32 = make('Spårvagn M32 med strömavtagare', (m) => (
  <>
    <Pantograph x={150} y={38} mode={m} />
    <rect
      x="8"
      y="38"
      width="284"
      height="42"
      rx="14"
      fill={fill(m, 'var(--paper-strong)')}
      stroke={edge(m)}
      strokeWidth="1.5"
    />
    <path d="M8 66 H292 V66 Q292 80 278 80 H22 Q8 80 8 66 Z" fill={fill(m, 'var(--tint-blue)')} />
    <Windows mode={m} xs={[22, 52, 82, 112, 142, 172, 202, 232]} y={44} w={24} h={16} />
    <rect x="262" y="44" width="22" height="16" rx="6" fill={fill(m, 'var(--window)')} />
    <g fill={fill(m, 'var(--ink-soft)')}>
      <rect x="100" y="40" width="6" height="40" />
      <rect x="196" y="40" width="6" height="40" />
    </g>
    <Wheels xs={[36, 60, 140, 164, 236, 260]} y={84} r={4.5} />
  </>
))

// M33: even longer tram with a sloped, glassy front and a yellow band.
const M33 = make('Spårvagn M33', (m) => (
  <>
    <Pantograph x={120} y={38} mode={m} />
    <path
      d="M8 80 V52 Q8 38 22 38 H250 Q282 40 292 62 V80 Z"
      fill={fill(m, 'var(--tint-blue)')}
      stroke={edge(m)}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <rect x="8" y="64" width="284" height="5" fill={fill(m, 'var(--tint-yellow)')} />
    <Windows mode={m} xs={range(18, 28, 8)} y={44} w={22} h={16} />
    <path d="M250 44 Q274 46 284 60 H250 Z" fill={fill(m, 'var(--window)')} />
    <g fill={fill(m, 'var(--ink-soft)')}>
      <rect x="82" y="40" width="6" height="40" />
      <rect x="170" y="40" width="6" height="40" />
    </g>
    <Wheels xs={[34, 58, 120, 144, 206, 230]} y={84} r={4.5} />
  </>
))

export const RAIL_ART: Record<string, ComponentType<VehicleArtProps>> = {
  x2000: X2000,
  regina: Regina,
  x60: X60,
  x31: X31,
  rc6: Rc6,
  iore: Iore,
  c20: C20,
  c30: C30,
  m32: M32,
  m33: M33,
}
