// One soft, short tone for a correct answer. No negative sounds exist by design.
let ctx: AudioContext | undefined

export function playSoftChime() {
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    gain.connect(ctx.destination)
    for (const [freq, delay] of [
      [660, 0],
      [880, 0.12],
    ]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(now + delay)
      osc.stop(now + 0.6)
    }
  } catch {
    // Audio unavailable: silently skip, the app never depends on sound.
  }
}
