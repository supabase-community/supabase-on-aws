-- Realtime schema
CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;

CREATE SCHEMA IF NOT EXISTS realtime;
ALTER SCHEMA realtime OWNER TO supabase_admin;

GRANT USAGE ON SCHEMA realtime TO postgres, dashboard_user;
