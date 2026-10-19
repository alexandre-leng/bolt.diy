-- Projects are owned per user: key on (user_id, slug) instead of slug alone.
--
-- Before this, `slug` was the sole PRIMARY KEY, so two accounts whose titles slugify the
-- same could not both record their site: the second PUT hit the ON CONFLICT branch, the
-- ownership guard rejected it, and the caller got 409 — a legitimate publish that silently
-- never appeared in their history. A slug belongs to a user, not to the installation.
--
-- Idempotent and safe to re-run on every boot (SCHEMA is applied at startup). Verified on a
-- database holding both an owned row and a legacy NULL-owner row.

-- 1. The column must exist before it can be part of a key.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. A PRIMARY KEY cannot contain NULL, and legacy rows created before projects carried an
--    owner have none. Assign them the only account that can own them: the installation's
--    first user, which is what the single-user deployment had in practice. Without this the
--    ALTER fails with "column user_id contains null values" and the migration aborts, which
--    is how this was caught: the failure is loud, not silent.
--    `users` belongs to bolt-accounts' migrations, so it may not exist yet on a fresh
--    database; the guard makes the statement a no-op there instead of an error.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'users') THEN
        UPDATE projects
           SET user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)
         WHERE user_id IS NULL
           AND EXISTS (SELECT 1 FROM users);
    END IF;
END $$;

-- 3. Swap the single-column key for the composite one.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND conname = 'projects_pkey'
          AND pg_get_constraintdef(oid) NOT LIKE '%user_id%'
    ) THEN
        ALTER TABLE projects DROP CONSTRAINT projects_pkey;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND conname = 'projects_pkey'
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT projects_pkey PRIMARY KEY (user_id, slug);
    END IF;
END $$;

-- 4. Keep both access paths indexed now that the key is composite.
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);

-- 5. The owner column is part of the key, so it can no longer be NULL: the existing
--    ON DELETE SET NULL foreign key is now incompatible (deleting a user would try to null
--    the key). Deleting an account should take its publish records with it, so the action
--    becomes CASCADE. Same shape as chat_tombstones' own user foreign key.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND conname = 'projects_user_id_fkey'
          AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL%'
    ) THEN
        ALTER TABLE projects DROP CONSTRAINT projects_user_id_fkey;
        ALTER TABLE projects ADD CONSTRAINT projects_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
