CREATE TABLE "study_materials" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"subject_guess" text,
	"topic" text NOT NULL,
	"summary" text NOT NULL,
	"concepts" jsonb NOT NULL,
	"curriculum_refs" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"processed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_page_extractions" (
	"sha256" text NOT NULL,
	"pdf_page" integer NOT NULL,
	"segments" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_page_extractions_sha256_pdf_page_pk" PRIMARY KEY("sha256","pdf_page")
);
--> statement-breakpoint
CREATE TABLE "study_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"file" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"pdf_page" integer,
	"source_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_segments" (
	"set_id" uuid NOT NULL,
	"id" text NOT NULL,
	"page" integer NOT NULL,
	"ord" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"data" jsonb,
	"confidence" text NOT NULL,
	CONSTRAINT "study_segments_set_id_id_pk" PRIMARY KEY("set_id","id")
);
--> statement-breakpoint
CREATE TABLE "study_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"failure" text,
	"job_id" uuid,
	"failed_at" timestamp with time zone,
	"sources_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_set_id_study_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."study_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_pages" ADD CONSTRAINT "study_pages_set_id_study_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."study_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_segments" ADD CONSTRAINT "study_segments_set_id_study_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."study_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sets" ADD CONSTRAINT "study_sets_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_pages_set_idx" ON "study_pages" USING btree ("set_id","page");--> statement-breakpoint
CREATE INDEX "study_pages_sha_idx" ON "study_pages" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "study_segments_order_idx" ON "study_segments" USING btree ("set_id","ord");--> statement-breakpoint
CREATE INDEX "study_sets_learner_idx" ON "study_sets" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "study_sets_status_idx" ON "study_sets" USING btree ("status");