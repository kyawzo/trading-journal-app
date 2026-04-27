-- Phase cleanup: remove legacy global workspace preference table.
-- User-scoped preferences now live in user_preferences.
DROP TABLE IF EXISTS "workspace_preferences";
