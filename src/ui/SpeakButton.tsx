import type { SpeechLang } from '../core/types'
import { useAppState } from '../store/store'
import { canSpeak, speak } from '../lib/speech'
import { Button } from './Button'

/** Reads text aloud on request. Hidden when speech is off or unsupported. */
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
  if (!enabled || !canSpeak()) return null
  return (
    <Button variant="secondary" icon="speaker" onClick={() => speak(text, lang)}>
      {label}
    </Button>
  )
}
