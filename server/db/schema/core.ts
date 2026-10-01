import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { LearnerProfileInput } from '../../../shared/contracts'

// Core household data. There are no user accounts: access control is the reverse proxy's job
// (e.g. Caddy + Authentik forward auth). Domain modules own their own schema files.

export const learners = pgTable('learners', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Validated LearnerProfileInput (shared/contracts/learner.ts). */
  profile: jsonb('profile').$type<LearnerProfileInput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
