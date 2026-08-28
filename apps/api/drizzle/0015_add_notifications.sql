DO $$ BEGIN
 CREATE TYPE "public"."notification_type" AS ENUM('reminder_due', 'note_modified', 'workspace_invitation');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
 "id" uuid PRIMARY KEY NOT NULL,
 "workspace_id" uuid NOT NULL,
 "type" "notification_type" NOT NULL,
 "title" text NOT NULL,
 "body" text DEFAULT '' NOT NULL,
 "read" boolean DEFAULT false NOT NULL,
 "version" integer DEFAULT 0 NOT NULL,
 "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_workspace_created_idx" ON "notifications" ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_workspace_read_idx" ON "notifications" ("workspace_id","read");
