import { date, integer, pgTable } from 'drizzle-orm/pg-core'

/** Generated images per day (DB clock), atomic upsert in server/images/limits; cap LIMIT_IMAGES_PER_DAY. */
export const imageGenerationDays = pgTable('image_generation_days', {
  day: date('day').primaryKey(),
  count: integer('count').notNull().default(0),
})
