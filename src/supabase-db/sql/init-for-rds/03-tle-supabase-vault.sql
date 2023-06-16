-- Enable Trusted Language Extensions
CREATE EXTENSION IF NOT EXISTS pg_tle;

-- Install supabase_vault
SELECT pgtle.install_extension(
'supabase_vault', '0.2.8', 'Supabase Vault Extension',
$pg_tle$
-- NOTE: Copy the contents of
-- https://github.com/supabase/vault/blob/main/sql/supabase_vault--0.2.8.sql
-- in here and remove the first line that contains "\echo"
CREATE TABLE vault.secrets (
  id uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  description text NOT NULL default '',
  secret      text NOT NULL,
  key_id      uuid REFERENCES pgsodium.key(id) DEFAULT (pgsodium.create_key()).id,
  nonce       bytea DEFAULT pgsodium.crypto_aead_det_noncegen(),
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE vault.secrets OWNER TO session_user;

COMMENT ON TABLE vault.secrets IS 'Table with encrypted `secret` column for storing sensitive information on disk.';

CREATE UNIQUE INDEX ON vault.secrets USING btree (name) WHERE name IS NOT NULL;

SECURITY LABEL FOR pgsodium ON COLUMN vault.secrets.secret IS
'ENCRYPT WITH KEY COLUMN key_id ASSOCIATED (id, description, created_at, updated_at) NONCE nonce';

SELECT pgsodium.update_mask('vault.secrets'::regclass::oid);

ALTER EXTENSION supabase_vault DROP VIEW vault.decrypted_secrets;
ALTER EXTENSION supabase_vault DROP FUNCTION vault.secrets_encrypt_secret_secret;

GRANT ALL ON SCHEMA vault TO pgsodium_keyiduser;
GRANT ALL ON TABLE vault.secrets TO pgsodium_keyiduser;
GRANT ALL PRIVILEGES ON vault.decrypted_secrets TO pgsodium_keyiduser;

CREATE OR REPLACE FUNCTION vault.create_secret(
    new_secret text,
    new_name text = NULL,
    new_description text = '',
    new_key_id uuid = NULL) RETURNS uuid AS
    $$
    INSERT INTO vault.secrets (secret, name, description, key_id)
    VALUES (
        new_secret,
        new_name,
        new_description,
        CASE WHEN new_key_id IS NULL THEN (pgsodium.create_key()).id ELSE new_key_id END)
    RETURNING id;
    $$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION vault.update_secret(
    secret_id uuid,
    new_secret text = NULL,
    new_name text = NULL,
    new_description text = NULL,
    new_key_id uuid = NULL) RETURNS void AS
    $$
	UPDATE vault.decrypted_secrets s
    SET
        secret = CASE WHEN new_secret IS NULL THEN s.decrypted_secret ELSE new_secret END,
        name = CASE WHEN new_name IS NULL THEN s.name ELSE new_name END,
        description = CASE WHEN new_description IS NULL THEN s.description ELSE new_description END,
        key_id = CASE WHEN new_key_id IS NULL THEN s.key_id ELSE new_key_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE s.id = secret_id
    $$ LANGUAGE SQL;

SELECT pg_catalog.pg_extension_config_dump('vault.secrets', '');
-- END
$pg_tle$,
'{pgcrypto}'
);