/** Float32 mono samples in [-1, 1] -> 16-bit PCM WAV bytes. */
export function floatToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  tag(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  tag(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true))
  return buf
}
