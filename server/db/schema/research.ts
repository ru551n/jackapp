import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import type { SchoolPosition } from '../../../shared/contracts'

// Web research (server/research). Only summaries, citations and short excerpts are stored,
// never full page text (docs/platform/research-and-licensing.md).

/** A model-written research brief: summary + key points citing `research_sources.index`. */
export const researchBriefs = pgTable('research_briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  topic: text('topic').notNull(),
  language: text('language').notNull(),
  school: jsonb('school').$type<SchoolPosition>(),
  brief: jsonb('brief').$type<{ summary: string; keyPoints: { text: string; sources: number[] }[] }>().notNull(),
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One cited web source of a brief. `excerpt` is capped at 300 chars. */
export const researchSources = pgTable(
  'research_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => researchBriefs.id, { onDelete: 'cascade' }),
    /** 1-based citation number used in the brief. */
    index: integer('index').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    publisher: text('publisher'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    excerpt: varchar('excerpt', { length: 300 }),
  },
  (t) => [index('research_sources_brief_idx').on(t.briefId)],
)
