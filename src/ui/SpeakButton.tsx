import type { SpeechLang } from '../core/types'
import { canSpeak, speak, useSpeechReady } from '../lib/speech'
import { useAppState } from '../store/store'
import { Button } from './Button'

/** Reads text aloud on request (bundled clip, else browser voice). Hidden when speech is off or impossible. */
export function SpeakButton({
  text,
  lang = 'sv',
  label = 'Lyssna',
}: {
  text: string
  lang?: SpeechLang
  label?: string
}) {
  const enabled = useAppState((s) => s.settings.speech)
  useSpeechReady()
  if (!enabled || !canSpeak(text, lang)) return null
  return (
    <Button variant="secondary" icon="speaker" onClick={() => speak(text, lang)}>
      {label}
    </Button>
  )
}
