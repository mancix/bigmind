ALTER TABLE "notes" ADD COLUMN "search_vector" tsvector;--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search_vector");--> statement-breakpoint
CREATE OR REPLACE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER notes_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content ON notes
  FOR EACH ROW
  EXECUTE FUNCTION notes_search_vector_update();--> statement-breakpoint
UPDATE "notes" SET search_vector = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(content, ''));
