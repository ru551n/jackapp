import { describe, expect, it } from 'vitest'
import { phonemesToIds } from './phonemes'
import { floatToWav } from './wav'

describe('phonemesToIds', () => {
  const map = { '^': [1], _: [0], $: [2], a: [5], b: [6, 7] }
  it('wraps with BOS/EOS and pads after every phoneme', () => {
    expect(phonemesToIds(['a', 'b'], map)).toEqual([1, 0, 5, 0, 6, 7, 0, 2])
  })
  it('drops unknown phonemes', () => {
    expect(phonemesToIds(['a', '?'], map)).toEqual([1, 0, 5, 0, 2])
  })
})

describe('floatToWav', () => {
  it('writes a 16-bit mono PCM header and clamped samples', () => {
    const wav = floatToWav(Float32Array.of(0, 1, -1, 2), 22050)
    const v = new DataView(wav)
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(wav, o, 4))
    expect([tag(0), tag(8), tag(36)]).toEqual(['RIFF', 'WAVE', 'data'])
    expect(wav.byteLength).toBe(44 + 8)
    expect(v.getUint32(24, true)).toBe(22050)
    expect(v.getUint32(40, true)).toBe(8)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([
      0, 32767, -32767, 32767,
    ])
  })
})
