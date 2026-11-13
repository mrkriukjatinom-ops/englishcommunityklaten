CREATE TABLE "admin_sessions" (
	"token" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"phone" text NOT NULL UNIQUE,
	"status" text DEFAULT 'registered' NOT NULL,
	"checked_in" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp
);
