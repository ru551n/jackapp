import { and, desc, eq, sql } from 'drizzle-orm'
import {
  Artifact as ArtifactSchema,
  type ApprovalState,
  type Artifact,
  type GenerationPolicy,
  type GenerationRequest,
} from '../../shared/contracts'
import type { Db } from '../db/client'
import { artifacts, artifactVersions, type IllustrationRequest, type MaterialTruncation } from '../db/schema'

// Artifact persistence. Versions are immutable; the artifact row points at the current one.

export type ArtifactRow = typeof artifacts.$inferSelect

export interface VersionMeta {
  origin: string
  illustrations?: IllustrationRequest[]
  model?: string
  providerKind?: string
  promptVersion?: string
  truncated?: MaterialTruncation
}

export interface StoredArtifact {
  row: ArtifactRow
  artifact: Artifact
  illustrations: IllustrationRequest[]
  truncated?: MaterialTruncation
}

export function approvalFor(policy: GenerationPolicy['approval'], ok: boolean): ApprovalState {
  return !ok ? 'draft' : policy === 'parent' ? 'pendingApproval' : 'approved'
}

/** Insert a new artifact with version 1. `content.id` becomes the artifact id. */
export async function createArtifact(
  db: Db,
  content: Artifact,
  request: GenerationRequest,
  meta: VersionMeta & { jobId?: string },
): Promise<Artifact> {
  const a = ArtifactSchema.parse({ ...content, version: 1 })
  await db.transaction(async (tx) => {
    await tx.insert(artifacts).values({
      id: a.id,
      learnerId: a.learnerId,
      type: a.type,
      title: a.title,
      subjectCode: a.subjectCode,
      school: a.school,
      sourceMode: a.sourceMode,
      studySetId: a.studySetId,
      feedback: a.feedback,
      approval: a.approval,
      currentVersion: 1,
      createdBy: a.createdBy,
      request,
      jobId: meta.jobId,
    })
    await tx.insert(artifactVersions).values(versionValues(a, meta))
  })
  return a
}

const versionValues = (a: Artifact, meta: VersionMeta) => ({
  artifactId: a.id,
  version: a.version,
  content: a,
  validation: a.validation,
  illustrations: meta.illustrations ?? [],
  origin: meta.origin,
  model: meta.model,
  providerKind: meta.providerKind,
  promptVersion: meta.promptVersion,
  truncated: meta.truncated,
})

/** The artifact made by a generate job, if an earlier attempt of the job already stored it. */
export async function artifactForJob(db: Db, jobId: string): Promise<string | undefined> {
  const [r] = await db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.jobId, jobId))
  return r?.id
}

/**
 * Store `content` as the next version and make it current. With `expectVersion`, returns undefined
 * (stores nothing) when another version landed meanwhile; `keepApproval` leaves the row's approval;
 * `approval` computes it from the row's current approval inside the transaction (no stale reads).
 */
export async function addVersion(
  db: Db,
  content: Artifact,
  meta: VersionMeta,
  /** New resolved request (transforms), so later transforms build on it. */
  request?: GenerationRequest,
  opts: { expectVersion?: number; keepApproval?: boolean; approval?: (current: ApprovalState) => ApprovalState } = {},
): Promise<Artifact | undefined> {
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ v: artifacts.currentVersion, approval: artifacts.approval })
      .from(artifacts)
      .where(eq(artifacts.id, content.id))
      .for('update')
    if (!cur) throw new Error('artifact missing')
    if (opts.expectVersion !== undefined && cur.v !== opts.expectVersion) return undefined
    const approval = opts.keepApproval ? cur.approval : opts.approval ? opts.approval(cur.approval) : content.approval
    const a = ArtifactSchema.parse({ ...content, approval, version: cur.v + 1 })
    await tx.insert(artifactVersions).values(versionValues(a, meta))
    await tx
      .update(artifacts)
      .set({
        currentVersion: a.version,
        title: a.title,
        approval: a.approval,
        feedback: a.feedback,
        ...(request ? { request } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(artifacts.id, a.id))
    return a
  })
}

/** Current version, with approval taken from the artifact row (approvals don't create versions). */
export async function loadArtifact(db: Db, id: string): Promise<StoredArtifact | undefined> {
  const [r] = await db
    .select({ row: artifacts, v: artifactVersions })
    .from(artifacts)
    .innerJoin(
      artifactVersions,
      and(eq(artifactVersions.artifactId, artifacts.id), eq(artifactVersions.version, artifacts.currentVersion)),
    )
    .where(eq(artifacts.id, id))
  if (!r) return undefined
  return {
    row: r.row,
    artifact: { ...r.v.content, approval: r.row.approval, version: r.row.currentVersion, title: r.row.title },
    illustrations: r.v.illustrations,
    truncated: r.v.truncated ?? undefined,
  }
}

/** Set the approval only while `version` is still current. False = another version landed (conflict). */
export async function setApproval(db: Db, id: string, approval: ApprovalState, version: number): Promise<boolean> {
  const rows = await db
    .update(artifacts)
    .set({ approval, updatedAt: sql`now()` })
    .where(and(eq(artifacts.id, id), eq(artifacts.currentVersion, version)))
    .returning({ id: artifacts.id })
  return rows.length > 0
}

export async function listVersions(db: Db, id: string) {
  return db
    .select({
      version: artifactVersions.version,
      origin: artifactVersions.origin,
      validation: artifactVersions.validation,
      createdAt: artifactVersions.createdAt,
    })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, id))
    .orderBy(desc(artifactVersions.version))
}

export async function listArtifacts(
  db: Db,
  learnerId: string,
  f: { type?: string; approval?: string; subjectCode?: string },
) {
  return db
    .select({
      id: artifacts.id,
      type: artifacts.type,
      title: artifacts.title,
      subjectCode: artifacts.subjectCode,
      school: artifacts.school,
      sourceMode: artifacts.sourceMode,
      approval: artifacts.approval,
      version: artifacts.currentVersion,
      createdBy: artifacts.createdBy,
      createdAt: artifacts.createdAt,
      updatedAt: artifacts.updatedAt,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.learnerId, learnerId),
        f.type ? eq(artifacts.type, f.type as never) : undefined,
        f.approval ? eq(artifacts.approval, f.approval as never) : undefined,
        f.subjectCode ? eq(artifacts.subjectCode, f.subjectCode) : undefined,
      ),
    )
    .orderBy(desc(artifacts.createdAt))
}

/** For runs: a specific version, or the current one (approval always from the artifact row). */
export async function loadArtifactVersion(db: Db, id: string, version?: number) {
  const current = await loadArtifact(db, id)
  if (!current) return undefined
  if (version === undefined || version === current.row.currentVersion) return current.artifact
  const [v] = await db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.artifactId, id), eq(artifactVersions.version, version)))
  return v ? { ...v.content, approval: current.row.approval, version, title: current.row.title } : undefined
}
