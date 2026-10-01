import type { FreeLine, FreeStation, LineVehicle } from '../../core/types'

export const MAX_STATIONS = 8
export const MAX_NAME = 16
export const GRID = 10
export const STATION_NAMES = ['Ängen', 'Hamnen', 'Skogen', 'Torget', 'Bron', 'Kullen', 'Sjön', 'Parken']
export const VEHICLES: {
  id: LineVehicle
  label: string
  sprite: 'locomotive' | 'metroCar' | 'tram'
  colour: string
}[] = [
  { id: 'train', label: 'Tåg', sprite: 'locomotive', colour: 'var(--tint-red)' },
  { id: 'metro', label: 'Tunnelbana', sprite: 'metroCar', colour: 'var(--tint-blue)' },
  { id: 'tram', label: 'Spårvagn', sprite: 'tram', colour: 'var(--tint-green)' },
]

export const emptyLine: FreeLine = { stations: [], vehicle: 'train' }

/** Snap to the coarse grid, keeping stations away from the map edge. */
export const snap = (v: number) => Math.min(90, Math.max(10, Math.round(v / GRID) * GRID))

const taken = (stations: FreeStation[], x: number, y: number) => stations.some((s) => s.x === x && s.y === y)

/** First unused default name; falls back to a numbered one. */
export function defaultName(stations: FreeStation[]) {
  const used = new Set(stations.map((s) => s.name))
  return STATION_NAMES.find((n) => !used.has(n)) ?? `Station ${stations.length + 1}`
}

function nextId(stations: FreeStation[]) {
  const max = stations.reduce((m, s) => Math.max(m, Number(s.id.slice(1)) || 0), 0)
  return `s${max + 1}`
}

// Snake order over 5 columns x 3 rows gives a tidy, readable default route.
const SPOTS = [20, 50, 80].flatMap((y, row) => {
  const xs = [10, 30, 50, 70, 90]
  return (row % 2 ? xs.slice().reverse() : xs).map((x) => ({ x, y }))
})

/** The next free grid spot, or null when none is left. */
export function freeSpot(stations: FreeStation[]) {
  return SPOTS.find((p) => !taken(stations, p.x, p.y)) ?? null
}

/** Add a station at (x, y) snapped to the grid. Returns the same line when full or the spot is taken. */
export function addStation(line: FreeLine, x: number, y: number): FreeLine {
  const sx = snap(x)
  const sy = snap(y)
  if (line.stations.length >= MAX_STATIONS || taken(line.stations, sx, sy)) return line
  const st = { id: nextId(line.stations), name: defaultName(line.stations), x: sx, y: sy }
  return { ...line, stations: [...line.stations, st] }
}

export function addAtFreeSpot(line: FreeLine): FreeLine {
  const p = freeSpot(line.stations)
  return p ? addStation(line, p.x, p.y) : line
}

export const removeLast = (line: FreeLine): FreeLine => ({ ...line, stations: line.stations.slice(0, -1) })

export function renameStation(line: FreeLine, id: string, name: string): FreeLine {
  const clean = name.trim().slice(0, MAX_NAME)
  if (!clean) return line
  return { ...line, stations: line.stations.map((s) => (s.id === id ? { ...s, name: clean } : s)) }
}

const dist = (a: FreeStation, b: FreeStation) => Math.hypot(a.x - b.x, a.y - b.y)

/** Distance along the route at which each station lies. */
export function stationOffsets(stations: FreeStation[]) {
  const out: number[] = []
  stations.forEach((s, i) => out.push(i ? out[i - 1] + dist(stations[i - 1], s) : 0))
  return out
}

/** Point at distance d along the route (clamped), plus the heading of the current segment. */
export function pointAt(stations: FreeStation[], d: number) {
  if (stations.length === 0) return { x: 50, y: 50, angle: 0 }
  if (stations.length === 1) return { x: stations[0].x, y: stations[0].y, angle: 0 }
  const offs = stationOffsets(stations)
  const found = offs.findIndex((o, i) => i > 0 && o >= d)
  const k = found < 0 ? stations.length - 1 : found
  const a = stations[k - 1]
  const b = stations[k]
  const t = Math.min(1, Math.max(0, (d - offs[k - 1]) / (offs[k] - offs[k - 1] || 1)))
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) }
}
