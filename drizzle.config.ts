import { defineConfig } from 'drizzle-kit'

// `npm run db:generate` writes SQL migrations; `npm run db:migrate` applies them (server/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
})
