import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const synth = vi.fn<(t: string, l: string) => Promise<Blob>>()
vi.mock('./piper', () => ({ isEngineSupported: () => true, synthesize: (t: string, l: string) => synth(t, l) }))

const played: string[] = []
class FakeAudio {
  src: string
  onended: (() => void) | null = null
  constructor(src = '') {
    this.src = src
  }
  play() {
    played.push(this.src)
    return Promise.resolve()
  }
  pause() {}
}
const spoken: string[] = []

async function load() {
  vi.resetModules()
  return import('./speech')
}

beforeEach(() => {
  played.length = 0
  spoken.length = 0
  synth.mockReset()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string
      constructor(t: string) {
        this.text = t
      }
    },
  )
  Object.assign(window, {
    speechSynthesis: { speak: (u: { text: string }) => spoken.push(u.text), cancel: () => {}, getVoices: () => [] },
  })
  URL.createObjectURL = () => 'blob:clip'
  URL.revokeObjectURL = () => {}
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('speak fallback order', () => {
  it('plays a bundled clip without touching the engine', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [(await import('./spoken')).speechKey({ text: 'Hej', lang: 'sv' })],
    }))
    const s = await load()
    s.preloadSpeech()
    await vi.waitFor(() => expect(s.hasClip('Hej', 'sv')).toBe(true))
    s.speak('Hej', 'sv')
    expect(played[0]).toMatch(/^audio\/[0-9a-f]{16}\.mp3$/)
    expect(synth).not.toHaveBeenCalled()
  })

  it('plays the Piper clip when there is no bundled clip', async () => {
    synth.mockResolvedValue(new Blob(['x']))
    const s = await load()
    s.speak('Hej', 'sv')
    await vi.waitFor(() => expect(played).toContain('blob:clip'))
    expect(spoken).toEqual([])
  })

  it('falls back to the device voice when synthesis fails', async () => {
    synth.mockRejectedValue(new Error('boom'))
    const s = await load()
    s.speak('Hej', 'sv')
    await vi.waitFor(() => expect(spoken).toEqual(['Hej']))
  })

  it('uses the device voice after 4 s and never plays the late clip', async () => {
    vi.useFakeTimers()
    let done!: (b: Blob) => void
    synth.mockReturnValue(new Promise((r) => (done = r)))
    const s = await load()
    s.speak('Hej', 'sv')
    await vi.advanceTimersByTimeAsync(4000)
    expect(spoken).toEqual(['Hej'])
    done(new Blob(['x']))
    await vi.advanceTimersByTimeAsync(0)
    expect(played).not.toContain('blob:clip')
  })

  it('stopSpeaking drops a pending result', async () => {
    let done!: (b: Blob) => void
    synth.mockReturnValue(new Promise((r) => (done = r)))
    const s = await load()
    s.speak('Hej', 'sv')
    s.stopSpeaking()
    done(new Blob(['x']))
    await Promise.resolve()
    await Promise.resolve()
    expect(played).not.toContain('blob:clip')
    expect(spoken).toEqual([])
  })
})
