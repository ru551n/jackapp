import type { Artifact, GenerationRequest, ProcessedStudyMaterial, ValidationReport } from '../../shared/contracts'
import { Artifact as ArtifactSchema } from '../../shared/contracts'

export interface ValidationContext {
  request: GenerationRequest
  /** Present when the artifact was generated from uploaded material (needed for grounding checks). */
  material?: ProcessedStudyMaterial
}

/**
 * Validate generated content before it is stored as usable. Contract owned by the orchestrator;
 * the full check suite (answers, math, grounding, language, age) lives in server/validation.
 */
export async function validateArtifact(artifact: Artifact, _ctx: ValidationContext): Promise<ValidationReport> {
  const parsed = ArtifactSchema.safeParse(artifact)
  return {
    ok: parsed.success,
    issues: parsed.success
      ? []
      : parsed.error.issues.map((i) => ({ severity: 'error' as const, code: 'schema', message: i.message })),
    checks: ['schema'],
    checkedAt: new Date().toISOString(),
  }
}
