import { z } from 'zod'
import { AiCapability } from './ai'
import { CurriculumRef } from './school'

/** Where a piece of generated content comes from. Every generated item carries one or more. */
export const SourceRef = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('upload'),
    studySetId: z.string().uuid(),
    /** 1-based page/image number in the ordered study set. */
    page: z.number().int().min(1),
    segmentId: z.string(),
    /** Short excerpt for adult inspection (never long copyrighted passages). */
    excerpt: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal('web'),
    url: z.string().url(),
    title: z.string().max(300),
    publisher: z.string().max(200).optional(),
    retrievedAt: z.string(),
  }),
  z.object({ kind: z.literal('curriculum'), ref: CurriculumRef }),
  /** Content produced from model knowledge without a document source. */
  z.object({ kind: z.literal('model'), capability: AiCapability }),
])
export type SourceRef = z.infer<typeof SourceRef>

/** Licence record for any external or generated media. Unknown licence → never auto-used. */
export const AssetLicense = z.object({
  /** SPDX-like id: "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "PD", "project-owned", "ai-generated", "unknown". */
  license: z.string(),
  licenseUrl: z.string().url().optional(),
  creator: z.string().max(200).optional(),
  /** Exact attribution text that must be rendered with the asset, if required. */
  attribution: z.string().max(500).optional(),
  sourceUrl: z.string().url().optional(),
  assetUrl: z.string().url().optional(),
  provider: z.string().max(100),
  retrievedAt: z.string(),
  /** Decided by the licensing module, never by a model. */
  autoUsable: z.boolean(),
})
export type AssetLicense = z.infer<typeof AssetLicense>

/** A stored media asset (external, AI-generated or project-owned) as referenced from content. */
export const MediaRef = z.object({
  assetId: z.string().uuid(),
  kind: z.enum(['image']),
  alt: z.string().max(300),
  /** True for AI-generated images; never used as authoritative reference imagery. */
  generated: z.boolean(),
  license: AssetLicense,
})
export type MediaRef = z.infer<typeof MediaRef>
