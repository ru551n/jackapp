import type { SpeechLang } from '../../core/types'

export interface Request {
  id: number
  text: string
  lang: SpeechLang
  /** Absolute URL of the folder holding the voice models. */
  base: string
}
export type Reply =
  | { type: 'progress'; value: number }
  | { type: 'ready' }
  | { type: 'done'; id: number; wav: ArrayBuffer }
  | { type: 'failed'; id: number; message: string }
