import { describe, expect, it } from 'vitest'
import {
  MAX_STATIONS,
  addAtFreeSpot,
  addStation,
  defaultName,
  emptyLine,
  freeSpot,
  pointAt,
  removeLast,
  renameStation,
  snap,
  stationOffsets,
} from './model'

const build = (n: number) => Array.from({ length: n }).reduce<typeof emptyLine>((l) => addAtFreeSpot(l), emptyLine)

describe('model', () => {
  it('snaps to the grid and clamps', () => {
    expect(snap(23)).toBe(20)
    expect(snap(0)).toBe(10)
    expect(snap(99)).toBe(90)
  })
  it('names stations from the list without repeats', () => {
    const l = build(3)
    expect(l.stations.map((s) => s.name)).toEqual(['Ängen', 'Hamnen', 'Skogen'])
    expect(defaultName(l.stations)).toBe('Torget')
  })
  it('finds free spots and refuses duplicates', () => {
    const l = addStation(emptyLine, 11, 24)
    expect(l.stations[0]).toMatchObject({ x: 10, y: 20 })
    expect(addStation(l, 12, 22)).toBe(l)
    expect(freeSpot(l.stations)).toEqual({ x: 30, y: 20 })
  })
  it('caps at max stations', () => {
    const l = build(MAX_STATIONS + 2)
    expect(l.stations).toHaveLength(MAX_STATIONS)
    expect(addStation(l, 55, 55)).toBe(l)
  })
  it('removes last and renames (trimmed, max 16)', () => {
    const l = build(2)
    expect(removeLast(l).stations).toHaveLength(1)
    expect(renameStation(l, 's1', '  Abcdefghijklmnopqrstu ').stations[0].name).toBe('Abcdefghijklmnop')
    expect(renameStation(l, 's1', '  ')).toBe(l)
  })
  it('interpolates along the route', () => {
    let l = addStation(emptyLine, 10, 10)
    l = addStation(l, 50, 10)
    l = addStation(l, 50, 50)
    expect(stationOffsets(l.stations)).toEqual([0, 40, 80])
    expect(pointAt(l.stations, 20)).toMatchObject({ x: 30, y: 10 })
    expect(pointAt(l.stations, 60)).toMatchObject({ x: 50, y: 30 })
    expect(pointAt(l.stations, 999)).toMatchObject({ x: 50, y: 50 })
    expect(pointAt(l.stations, 0)).toMatchObject({ x: 10, y: 10 })
  })
})
