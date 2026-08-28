ALTER TABLE "workspaces" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "created_at" timestamp with time zone NOT NULL DEFAULT now();