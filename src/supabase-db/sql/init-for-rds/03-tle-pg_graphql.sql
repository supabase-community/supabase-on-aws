-- Enable PL/Rust
CREATE EXTENSION IF NOT EXISTS plrust;

-- Install pg_graphql
--SELECT pgtle.install_extension(
--'pg_graphql', '1.2.0', 'GraphQL support for PostgreSQL',
--$pg_tle$
---- NOTE: Copy the contents of
---- https://github.com/supabase/pg_graphql
---- in here and remove the first line that contains "\echo"
--$pg_tle$,
--'{pgcrypto}'
--);