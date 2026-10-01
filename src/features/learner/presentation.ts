import { useLayoutEffect, type CSSProperties } from 'react'
import type { AgeBand } from '../../../shared/contracts'
import type { Presentation } from './api'

// Support preferences → CSS variables, data attributes and flags. Applies in every age band.

export interface PresentationFlags {
  band: AgeBand
  readAloud: boolean
  sound: boolean
  reducedMotion: boolean
  stepByStep: boolean
  maxChoices: number
  textAmount: Presentation['textAmount']
  /** Spread onto the learner root element. */
  rootProps: { style: CSSProperties; 'data-band': AgeBand; 'data-text': string; 'data-visual': string }
}

const VISUAL_SCALE = { high: 1.25, normal: 1, low: 0.85 } as const

export function presentationFlags(p: Presentation): PresentationFlags {
  const style: Record<string, string> = { '--visual-scale': String(VISUAL_SCALE[p.visualSupport]) }
  if (p.reducedVisualComplexity) style['--shadow'] = 'none'
  return {
    band: p.ageBand,
    readAloud: p.readAloud,
    sound: p.sound,
    reducedMotion: p.reducedMotion,
    stepByStep: p.stepByStep,
    maxChoices: p.maxChoices,
    textAmount: p.textAmount,
    rootProps: {
      style: style as CSSProperties,
      'data-band': p.ageBand,
      'data-text': p.textAmount,
      'data-visual': p.visualSupport,
    },
  }
}

/** Flags for the learner's presentation; mirrors band and reduced motion onto <html> while mounted. */
export function usePresentation(p: Presentation): PresentationFlags {
  const flags = presentationFlags(p)
  const { band, reducedMotion } = flags
  // Layout effect: set before paint (no flash of the wrong band) and before tests read it.
  useLayoutEffect(() => {
    const root = document.documentElement.dataset
    const prevMotion = root.motion
    root.band = band
    if (reducedMotion) root.motion = 'reduced'
    return () => {
      delete root.band
      if (prevMotion === undefined) delete root.motion
      else root.motion = prevMotion
    }
  }, [band, reducedMotion])
  return flags
}
