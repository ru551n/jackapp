import { useAppState } from '../store/store'
import { canSpeak, speak } from '../lib/speech'
import { Button } from './Button'

/** "Lyssna" button: reads text aloud on request. Hidden when speech is off or unsupported. */
export function SpeakButton({ text }: { text: string }) {
  const enabled = useAppState((s) => s.settings.speech)
  if (!enabled || !canSpeak()) return null
  return (
    <Button variant="secondary" icon="speaker" onClick={() => speak(text)}>
      Lyssna
    </Button>
  )
}
