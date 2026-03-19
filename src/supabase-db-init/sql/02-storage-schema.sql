-- Storage schema setup (Storage API manages its own migrations, but needs the schema)
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;

GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER USER supabase_storage_admin SET search_path = 'storage';
