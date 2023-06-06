-- postgres user for developers
CREATE USER postgres WITH LOGIN;
GRANT rds_replication TO postgres;
