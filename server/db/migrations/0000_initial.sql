CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"learner_id" uuid,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" jsonb,
	"progress" real DEFAULT 0 NOT NULL,
	"step" text,
	"result_id" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_settings" (
	"id" text PRIMARY KEY DEFAULT 'household' NOT NULL,
	"adult_pin_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_skill_progress" (
	"learner_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"import_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"attempts" integer NOT NULL,
	"first_try" integer NOT NULL,
	"hints_used" integer NOT NULL,
	"recent" jsonb NOT NULL,
	"level_locked" boolean DEFAULT false NOT NULL,
	"last_practiced_at" timestamp with time zone,
	CONSTRAINT "legacy_skill_progress_learner_id_skill_pk" PRIMARY KEY("learner_id","skill")
);
--> statement-breakpoint
CREATE TABLE "curriculum_items" (
	"version" text NOT NULL,
	"id" text NOT NULL,
	"subject_code" text NOT NULL,
	"kind" text NOT NULL,
	"span" text,
	"section" text,
	"area" text,
	"grade_step" text,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "curriculum_items_version_id_pk" PRIMARY KEY("version","id")
);
--> statement-breakpoint
CREATE TABLE "curriculum_subjects" (
	"version" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"stage" text NOT NULL,
	"applicable_years" jsonb NOT NULL,
	"syllabus_type" text NOT NULL,
	"reform" text,
	"categories" jsonb NOT NULL,
	"school_types" jsonb NOT NULL,
	"valid_from" text,
	"valid_until" text,
	"source_version" integer,
	"purpose" text NOT NULL,
	"courses" jsonb NOT NULL,
	"source_url" text NOT NULL,
	CONSTRAINT "curriculum_subjects_version_code_pk" PRIMARY KEY("version","code")
);
--> statement-breakpoint
CREATE TABLE "curriculum_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"api_version" text NOT NULL,
	"licence" text NOT NULL,
	"source_urls" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_request_buckets" (
	"hour" timestamp with time zone PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"alt" text NOT NULL,
	"generated" boolean NOT NULL,
	"license" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"subject_code" text,
	"artifact_id" uuid,
	"item_id" text,
	"correct" boolean NOT NULL,
	"misses" integer NOT NULL,
	"hints_used" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_progress" ADD CONSTRAINT "legacy_progress_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_skill_progress" ADD CONSTRAINT "legacy_skill_progress_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_skill_progress" ADD CONSTRAINT "legacy_skill_progress_import_id_legacy_progress_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_version_subject_code_curriculum_subjects_version_code_fk" FOREIGN KEY ("version","subject_code") REFERENCES "public"."curriculum_subjects"("version","code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_subjects" ADD CONSTRAINT "curriculum_subjects_version_curriculum_versions_version_fk" FOREIGN KEY ("version") REFERENCES "public"."curriculum_versions"("version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("state","type","run_after");--> statement-breakpoint
CREATE INDEX "jobs_learner_idx" ON "jobs" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_finished_idx" ON "jobs" USING btree ("finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active_idx" ON "jobs" USING btree ("dedupe_key") WHERE state in ('queued', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_progress_learner_hash_idx" ON "legacy_progress" USING btree ("learner_id","payload_hash");--> statement-breakpoint
CREATE INDEX "legacy_skill_import_idx" ON "legacy_skill_progress" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "curriculum_items_subject_idx" ON "curriculum_items" USING btree ("version","subject_code");--> statement-breakpoint
CREATE INDEX "curriculum_subjects_stage_idx" ON "curriculum_subjects" USING btree ("version","stage");--> statement-breakpoint
CREATE INDEX "assets_sha_idx" ON "assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "skill_evidence_learner_idx" ON "skill_evidence" USING btree ("learner_id","skill","at");