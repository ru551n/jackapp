ALTER TABLE "artifact_versions" ADD COLUMN "truncated" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_job_idx" ON "artifacts" USING btree ("job_id");