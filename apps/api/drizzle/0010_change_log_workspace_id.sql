ALTER TABLE "change_log" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "change_log" SET "workspace_id" = "owner_id"::uuid WHERE "owner_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';--> statement-breakpoint
DELETE FROM "change_log" WHERE "workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "change_log" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "change_log" DROP COLUMN "owner_id";--> statement-breakpoint
DROP INDEX IF EXISTS "change_log_owner_sequence_idx";--> statement-breakpoint
CREATE INDEX "change_log_workspace_sequence_idx" ON "change_log" ("workspace_id", "sequence");--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;