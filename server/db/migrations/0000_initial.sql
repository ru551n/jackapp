CREATE TYPE "public"."learner_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "learner_access" (
	"learner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "learner_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_access_learner_id_user_id_pk" PRIMARY KEY("learner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_issuer" text NOT NULL,
	"oidc_subject" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "learner_access" ADD CONSTRAINT "learner_access_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_access" ADD CONSTRAINT "learner_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_oidc_idx" ON "users" USING btree ("oidc_issuer","oidc_subject");