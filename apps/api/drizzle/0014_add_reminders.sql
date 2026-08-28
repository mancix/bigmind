CREATE TABLE IF NOT EXISTS "reminders" (
 "id" uuid PRIMARY KEY NOT NULL,
 "workspace_id" uuid NOT NULL,
 "title" text NOT NULL,
 "description" text DEFAULT '' NOT NULL,
 "due_at" timestamp with time zone NOT NULL,
 "completed" boolean DEFAULT false NOT NULL,
 "created_by" uuid NOT NULL,
 "linked_note_id" uuid,
 "version" integer NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminders" ADD CONSTRAINT "reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminders" ADD CONSTRAINT "reminders_linked_note_id_notes_id_fk" FOREIGN KEY ("linked_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_workspace_due_idx" ON "reminders" ("workspace_id","due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_workspace_completed_idx" ON "reminders" ("workspace_id","completed");
