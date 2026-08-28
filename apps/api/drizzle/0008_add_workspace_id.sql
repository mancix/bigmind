ALTER TABLE notes ADD COLUMN workspace_id uuid;--> statement-breakpoint
ALTER TABLE categories ADD COLUMN workspace_id uuid;--> statement-breakpoint
ALTER TABLE note_links ADD COLUMN workspace_id uuid;--> statement-breakpoint
ALTER TABLE sync_operations ADD COLUMN workspace_id uuid;--> statement-breakpoint
INSERT INTO workspaces (id, name, created_at, updated_at)
SELECT '00000000-0000-4000-a000-000000000000'::uuid, 'Default', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM workspaces LIMIT 1);--> statement-breakpoint
UPDATE notes SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL;--> statement-breakpoint
UPDATE categories SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL;--> statement-breakpoint
UPDATE note_links SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL;--> statement-breakpoint
UPDATE sync_operations SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL;--> statement-breakpoint
ALTER TABLE notes ALTER COLUMN workspace_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE categories ALTER COLUMN workspace_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE note_links ALTER COLUMN workspace_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE sync_operations ALTER COLUMN workspace_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE notes ADD CONSTRAINT notes_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE note_links ADD CONSTRAINT note_links_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE notes DROP COLUMN owner_id;--> statement-breakpoint
ALTER TABLE categories DROP COLUMN owner_id;--> statement-breakpoint
ALTER TABLE note_links DROP COLUMN owner_id;--> statement-breakpoint
ALTER TABLE sync_operations DROP COLUMN owner_id;--> statement-breakpoint
DROP INDEX IF EXISTS notes_owner_updated_idx;--> statement-breakpoint
DROP INDEX IF EXISTS categories_owner_parent_position_idx;--> statement-breakpoint
DROP INDEX IF EXISTS note_links_owner_source_idx;--> statement-breakpoint
DROP INDEX IF EXISTS note_links_owner_target_idx;--> statement-breakpoint
DROP INDEX IF EXISTS sync_operations_owner_idx;--> statement-breakpoint
CREATE INDEX notes_workspace_updated_idx ON notes (workspace_id, updated_at);--> statement-breakpoint
CREATE INDEX categories_workspace_parent_position_idx ON categories (workspace_id, parent_id, position);--> statement-breakpoint
CREATE INDEX note_links_workspace_source_idx ON note_links (workspace_id, source_note_id);--> statement-breakpoint
CREATE INDEX note_links_workspace_target_idx ON note_links (workspace_id, target_note_id);--> statement-breakpoint
CREATE INDEX sync_operations_workspace_idx ON sync_operations (workspace_id);
