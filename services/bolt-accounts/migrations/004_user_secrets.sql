-- 004 — Per-user secrets (API keys and provider connections), stored encrypted.
--
-- GitHub, Netlify, Vercel, Supabase and provider keys lived only in the browser's
-- localStorage, so signing in on a second device asked for all of them again and a
-- cleared browser lost them for good. They belong to the account — but unlike a theme,
-- a leaked value is a credential that spends money or writes to remote services.
--
-- Therefore: `value` holds an AES-256-GCM ciphertext (iv.tag.data, base64) produced by
-- bolt-accounts/secret_crypto.py, never plaintext. The encryption key lives in the
-- service's environment file, NOT in this database, so a dump of this table alone is
-- useless without it. The server also never returns a decrypted value to a client: the
-- read endpoint reports the NAMES that exist, and the value only travels back through a
-- server-side call that needs it.
--
-- One row per (user, name): a fixed set of known secret names, enforceable by a unique
-- constraint, instead of a JSONB blob that could drift.

CREATE TABLE IF NOT EXISTS user_secrets (
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name),
    CONSTRAINT user_secrets_name_len CHECK (char_length(name) BETWEEN 1 AND 64),
    -- A malformed ciphertext must not be storable: catch it at write time rather than
    -- discovering it when a decryption fails months later.
    CONSTRAINT user_secrets_is_ciphertext CHECK (value ~ '^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$')
);

CREATE INDEX IF NOT EXISTS idx_user_secrets_user ON user_secrets (user_id);
