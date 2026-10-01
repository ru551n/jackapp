import { useState, type MouseEvent, type RefObject } from 'react'
import type { FreeLine } from '../../core/types'
import { Sprite } from '../../art/sprites'
import { VEHICLES, pointAt } from './model'
import styles from './FreePlay.module.css'

interface Props {
  line: FreeLine
  d: number
  selected: string | null
  onAdd: (x: number, y: number) => void
  onSelect: (id: string) => void
  stationRefs: RefObject<Map<string, SVGGElement>>
  /** Index of the station the vehicle is stopped at, or null while moving. */
  at: number | null
}

export function LineMap({ line, d, selected, onAdd, onSelect, stationRefs, at }: Props) {
  const v = VEHICLES.find((x) => x.id === line.vehicle) ?? VEHICLES[0]
  const pts = line.stations.map((s) => `${s.x},${s.y}`).join(' ')
  const pos = pointAt(line.stations, d)
  // Face the departing direction, updated only while dwelling at a station.
  const [flip, setFlip] = useState(false)
  const want = Math.cos(pointAt(line.stations, d + 0.01).angle) < 0
  if (at !== null && want !== flip) setFlip(want)
  const click = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width) onAdd(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100)
  }
  return (
    <svg viewBox="0 0 100 100" className={styles.map} onClick={click} role="group" aria-label="Karta">
      <path d="M0 78 Q25 62 45 82 T100 70 V100 H0 Z" className={styles.water} />
      <ellipse cx="80" cy="22" rx="16" ry="11" className={styles.park} />
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i} className={styles.grid}>
          <line x1={10 + i * 10} y1="0" x2={10 + i * 10} y2="100" />
          <line x1="0" y1={10 + i * 10} x2="100" y2={10 + i * 10} />
        </g>
      ))}
      {line.stations.length > 1 && (
        <polyline
          points={pts}
          fill="none"
          stroke={v.colour}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {line.stations.map((s) => (
        <g
          key={s.id}
          role="button"
          tabIndex={0}
          ref={(el) => {
            if (el) stationRefs.current.set(s.id, el)
            else stationRefs.current.delete(s.id)
          }}
          aria-label={`Station ${s.name}`}
          className={styles.station}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(s.id)
          }}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(s.id))}
        >
          <circle cx={s.x} cy={s.y} r="5" fill="transparent" className={styles.hit} />
          <circle cx={s.x} cy={s.y} r="2.6" className={s.id === selected ? styles.dotSel : styles.dot} />
          <text x={s.x} y={s.y + (s.y > 85 ? -5 : 8)} textAnchor="middle" className={styles.label}>
            {s.name}
          </text>
        </g>
      ))}
      {line.stations.length > 0 && (
        <svg
          x={pos.x - 8}
          y={pos.y - 11}
          width="16"
          height="10"
          viewBox="0 0 100 60"
          className={styles.vehicle}
          style={{ pointerEvents: 'none' }}
        >
          <g transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>
            <Sprite id={v.sprite} />
          </g>
        </svg>
      )}
    </svg>
  )
}
