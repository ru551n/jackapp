import { index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { LearnerProfileInput } from '../../../shared/contracts'

// Core identity and ownership. Domain modules own their own schema files (see schema/index.ts).

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** OIDC issuer + subject is the stable identity; never a password. */
    oidcIssuer: text('oidc_issuer').notNull(),
    oidcSubject: text('oidc_subject').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [index('users_oidc_idx').on(t.oidcIssuer, t.oidcSubject)],
)

export const learners = pgTable('learners', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Validated LearnerProfileInput (shared/contracts/learner.ts). */
  profile: jsonb('profile').$type<LearnerProfileInput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const learnerRole = pgEnum('learner_role', ['owner', 'editor', 'viewer'])

/** Many adults may share a learner. Authorization always goes through this table. */
export const learnerAccess = pgTable(
  'learner_access',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: learnerRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.userId] })],
)
