import { integer, pgTable, timestamp } from 'drizzle-orm/pg-core'

/** Global AI request counter per hour (app + worker), incremented with an atomic upsert (server/ai/limits.ts). */
export const aiRequestBuckets = pgTable('ai_request_buckets', {
  hour: timestamp('hour', { withTimezone: true }).primaryKey(),
  count: integer('count').notNull().default(0),
})
