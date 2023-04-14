-- Because supabase_admin is not a superuser in AWS RDS, we manually grant all the rights to the realtime schema
GRANT USAGE ON SCHEMA realtime TO supabase_admin;
GRANT ALL ON ALL TABLES IN SCHEMA realtime TO supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA realtime TO supabase_admin;
GRANT ALL ON ALL ROUTINES IN SCHEMA realtime TO supabase_admin;
