-- Auth schema setup (GoTrue manages its own migrations, but needs the schema)
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;

GRANT USAGE ON SCHEMA auth TO postgres, dashboard_user;
ALTER USER supabase_auth_admin SET search_path = 'auth';

GRANT supabase_auth_admin TO postgres;
GRANT authenticator TO supabase_storage_admin;
