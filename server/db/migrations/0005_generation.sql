CREATE TABLE "artifact_versions" (
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"illustrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text NOT NULL,
	"model" text,
	"provider_kind" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_artifact_id_version_pk" PRIMARY KEY("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"subject_code" text,
	"school" jsonb NOT NULL,
	"source_mode" text NOT NULL,
	"study_set_id" uuid,
	"feedback" text NOT NULL,
	"approval" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"request" jsonb NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_learner_idx" ON "artifacts" USING btree ("learner_id","created_at");