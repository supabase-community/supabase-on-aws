-- default superuser
GRANT rds_replication TO postgres;

-- Supabase super admin
create user supabase_admin;
alter user supabase_admin with createdb createrole bypassrls;
grant supabase_admin to postgres;
grant rds_superuser to supabase_admin; -- for RDS
grant rds_replication to supabase_admin; -- for RDS
