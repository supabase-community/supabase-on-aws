-- migrate:up
-- Unfortunately, in RDS we do not have permissions to set the session_preload_libraries parameter
-- ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate';

-- migrate:down
