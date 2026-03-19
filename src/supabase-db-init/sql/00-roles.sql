-- Create base roles and users for Supabase on an external Aurora database.
-- The admin user (supabase_admin) already exists as the Aurora master user.

-- Extension namespacing
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;

-- Realtime publication
CREATE PUBLICATION IF NOT EXISTS supabase_realtime;

-- Grant admin additional privileges
ALTER USER supabase_admin WITH CREATEDB CREATEROLE BYPASSRLS;

-- Supabase replication user
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_replication_admin') THEN
    CREATE USER supabase_replication_admin WITH LOGIN;
  END IF;
END $$;

-- Supabase read-only user
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    CREATE ROLE supabase_read_only_user WITH LOGIN BYPASSRLS;
    GRANT pg_read_all_data TO supabase_read_only_user;
  END IF;
END $$;

-- Auth roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Authenticator user
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE USER authenticator NOINHERIT;
  END IF;
END $$;
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT supabase_admin TO authenticator;

-- pgbouncer user (for Supavisor)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgbouncer') THEN
    CREATE USER pgbouncer NOINHERIT;
  END IF;
END $$;

-- postgres user (for developer access)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE USER postgres WITH LOGIN;
  END IF;
END $$;

-- dashboard_user
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE USER dashboard_user WITH LOGIN;
  END IF;
END $$;

-- supabase_auth_admin
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE USER supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
END $$;

-- supabase_storage_admin
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE USER supabase_storage_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
END $$;

-- supabase_functions_admin
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
    CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
END $$;

-- Schema grants
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Admin search path
ALTER USER supabase_admin SET search_path TO public, extensions;

-- Default privileges for admin-created objects
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- Grant roles
GRANT supabase_auth_admin TO postgres;
GRANT supabase_storage_admin TO postgres;
GRANT supabase_functions_admin TO postgres;
GRANT anon TO postgres;
GRANT authenticated TO postgres;
GRANT service_role TO postgres;
GRANT supabase_admin TO postgres;
