ALTER TYPE "public"."sync_entity_type" ADD VALUE 'link';--> statement-breakpoint
CREATE TABLE "note_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_note_id" uuid NOT NULL,
	"target_note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "note_links_source_target_unique" UNIQUE("source_note_id","target_note_id")
);
--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_target_note_id_notes_id_fk" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_links_owner_source_idx" ON "note_links" USING btree ("owner_id","source_note_id");--> statement-breakpoint
CREATE INDEX "note_links_owner_target_idx" ON "note_links" USING btree ("owner_id","target_note_id");