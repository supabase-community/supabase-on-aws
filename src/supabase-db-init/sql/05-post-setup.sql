-- Post-setup grants and permissions

-- Authenticator timeout
ALTER ROLE authenticator SET statement_timeout = '8s';

-- pgbouncer auth schema
CREATE SCHEMA IF NOT EXISTS pgbouncer;
CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename TEXT)
RETURNS TABLE(username TEXT, password TEXT) AS
$$
BEGIN
  RAISE WARNING 'PgBouncer auth request: %', p_usename;
  RETURN QUERY
  SELECT usename::TEXT, passwd::TEXT FROM pg_catalog.pg_shadow
  WHERE usename = p_usename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION pgbouncer.get_auth FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pgbouncer.get_auth TO pgbouncer;
GRANT USAGE ON SCHEMA pgbouncer TO pgbouncer;

-- API roles inherit fix
ALTER ROLE anon INHERIT;
ALTER ROLE authenticated INHERIT;
ALTER ROLE service_role INHERIT;
