DO $$ BEGIN
 CREATE TYPE "public"."note_template_type" AS ENUM('MARKDOWN', 'TODO_LIST');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "template_type" "note_template_type" DEFAULT 'MARKDOWN' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todo_lists" (
 "id" uuid PRIMARY KEY NOT NULL,
 "note_id" uuid NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todo_items" (
 "id" uuid PRIMARY KEY NOT NULL,
 "todo_list_id" uuid NOT NULL,
 "text" text NOT NULL,
 "completed" boolean DEFAULT false NOT NULL,
 "position" integer NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todo_lists" ADD CONSTRAINT "todo_lists_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todo_items" ADD CONSTRAINT "todo_items_todo_list_id_todo_lists_id_fk" FOREIGN KEY ("todo_list_id") REFERENCES "public"."todo_lists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
