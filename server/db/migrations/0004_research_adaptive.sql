CREATE TABLE "research_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"language" text NOT NULL,
	"school" jsonb,
	"brief" jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"excerpt" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "adaptive_legacy_skills" (
	"learner_id" uuid NOT NULL,
	"legacy_skill" text NOT NULL,
	"skill" text NOT NULL,
	"import_id" uuid NOT NULL,
	"outcomes" jsonb NOT NULL,
	"attempts" integer NOT NULL,
	"last_practiced_at" timestamp with time zone,
	CONSTRAINT "adaptive_legacy_skills_learner_id_legacy_skill_pk" PRIMARY KEY("learner_id","legacy_skill")
);
--> statement-breakpoint
CREATE TABLE "learning_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"subject_code" text,
	"target_date" text,
	"study_set_id" uuid,
	"status" text NOT NULL,
	"milestones" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_evidence_kinds" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"item_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_reviews" (
	"learner_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"step" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_reviews_learner_id_skill_pk" PRIMARY KEY("learner_id","skill")
);
--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_brief_id_research_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."research_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptive_legacy_skills" ADD CONSTRAINT "adaptive_legacy_skills_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptive_legacy_skills" ADD CONSTRAINT "adaptive_legacy_skills_import_id_legacy_progress_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."legacy_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence_kinds" ADD CONSTRAINT "skill_evidence_kinds_evidence_id_skill_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."skill_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_reviews" ADD CONSTRAINT "skill_reviews_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_sources_brief_idx" ON "research_sources" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "learning_paths_learner_idx" ON "learning_paths" USING btree ("learner_id");