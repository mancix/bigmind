CREATE TYPE "public"."sync_entity_type" AS ENUM('note');--> statement-breakpoint
CREATE TYPE "public"."sync_operation_type" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."sync_result_status" AS ENUM('accepted', 'rejected', 'conflict');--> statement-breakpoint
CREATE TABLE "change_log" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_type" "sync_entity_type" NOT NULL,
	"operation_type" "sync_operation_type" NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"result_status" "sync_result_status" NOT NULL,
	"result_payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "change_log_owner_sequence_idx" ON "change_log" USING btree ("owner_id","sequence");--> statement-breakpoint
CREATE INDEX "notes_owner_updated_idx" ON "notes" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "sync_operations_owner_idx" ON "sync_operations" USING btree ("owner_id");