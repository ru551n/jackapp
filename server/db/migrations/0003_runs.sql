CREATE TABLE "run_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"answer" jsonb NOT NULL,
	"correct" boolean,
	"score" real,
	"hints_shown" integer DEFAULT 0 NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"ai_assessed" boolean DEFAULT false NOT NULL,
	"feedback" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_version" integer NOT NULL,
	"mode" text NOT NULL,
	"feedback" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"hints_shown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run_answers" ADD CONSTRAINT "run_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_answers_attempt_uq" ON "run_answers" USING btree ("run_id","item_id","attempt");--> statement-breakpoint
CREATE INDEX "runs_learner_artifact_idx" ON "runs" USING btree ("learner_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_uq" ON "runs" USING btree ("learner_id","artifact_id") WHERE state = 'active';