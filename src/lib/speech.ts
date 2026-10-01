// Browser speech synthesis in Swedish. Only ever triggered by a button press (never autoplay).

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

function swedishVoice(): SpeechSynthesisVoice | undefined {
  return window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('sv'))
}

/** True when a Swedish voice is installed. Voices load async in some browsers, so re-check on use. */
export const hasSwedishVoice = () => canSpeak() && swedishVoice() !== undefined

export function speak(text: string) {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'sv-SE'
  u.rate = 0.85
  const voice = swedishVoice()
  if (voice) u.voice = voice
  synth.speak(u)
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}
