import type { Artifact, Item } from '../../shared/contracts'
import type { IllustrationRequest } from '../db/schema'
import type { StoredArtifact } from './store'

// Learner-facing views and the illustration hook for the image domain.

type Stripped<T> = T extends Item
  ? Omit<
      T,
      'answer' | 'answers' | 'explanation' | 'rubric' | 'sampleAnswer' | 'blanks' | 'pairs' | 'tolerance' | 'check'
    >
  : never
export type LearnerItem = Stripped<Item> & {
  /** fillBlank: number of blanks. */
  blankCount?: number
  /** matching: left column in order, right column sorted (not paired). */
  left?: string[]
  right?: string[]
}
export type LearnerArtifact = Omit<Artifact, 'validation' | 'sections'> & {
  sections: (Omit<Artifact['sections'][number], 'items'> & { items: LearnerItem[] })[]
}

/** Strip answers, rubrics and explanations (used when feedback is given at the end). */
export function forLearner(a: Artifact): LearnerArtifact {
  const { validation: _v, ...rest } = a
  return {
    ...rest,
    sections: a.sections.map((s) => ({
      ...s,
      items: s.items.map((item) => {
        const {
          answer: _a,
          answers: _as,
          explanation: _e,
          rubric: _r,
          sampleAnswer: _sa,
          blanks,
          pairs,
          tolerance: _t,
          check: _c,
          ...keep
        } = item as Item & Record<string, unknown>
        const out = keep as LearnerItem
        if (Array.isArray(blanks)) out.blankCount = blanks.length
        if (Array.isArray(pairs)) {
          const p = pairs as { left: string; right: string }[]
          out.left = p.map((x) => x.left)
          out.right = p.map((x) => x.right).sort((x, y) => x.localeCompare(y, 'sv'))
        }
        return out
      }),
    })),
  }
}

/**
 * Hook for the image domain: illustrations items (or their choices) asked for that have no media yet.
 * Fill by adding a MediaRef to the item or choice (as a new version).
 */
export function requestedIllustrations(
  stored: Pick<StoredArtifact, 'artifact' | 'illustrations'>,
): IllustrationRequest[] {
  const items = new Map(stored.artifact.sections.flatMap((s) => s.items.map((i) => [i.id, i] as const)))
  return stored.illustrations.filter((r) => {
    const it = items.get(r.itemId)
    if (!it) return true
    if (r.choice === undefined) return !it.media.length
    return 'choices' in it && !!it.choices[r.choice] && !it.choices[r.choice]!.media
  })
}
