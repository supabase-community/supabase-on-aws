create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Unfortunately, the pgjwt extension is not available in the AWS RDS. Therefore, we load it manually
-- from https://github.com/michelp/pgjwt/blob/master/pgjwt--0.2.0.sql
CREATE OR REPLACE FUNCTION extensions.url_encode(data bytea) RETURNS text LANGUAGE sql AS $$
    SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
$$ IMMUTABLE;


CREATE OR REPLACE FUNCTION extensions.url_decode(data text) RETURNS bytea LANGUAGE sql AS $$
WITH t AS (SELECT translate(data, '-_', '+/') AS trans),
     rem AS (SELECT length(t.trans) % 4 AS remainder FROM t) -- compute padding size
    SELECT decode(
        t.trans ||
        CASE WHEN rem.remainder > 0
           THEN repeat('=', (4 - rem.remainder))
           ELSE '' END,
    'base64') FROM t, rem;
$$ IMMUTABLE;


CREATE OR REPLACE FUNCTION extensions.algorithm_sign(signables text, secret text, algorithm text)
RETURNS text LANGUAGE sql AS $$
WITH
  alg AS (
    SELECT CASE
      WHEN algorithm = 'HS256' THEN 'sha256'
      WHEN algorithm = 'HS384' THEN 'sha384'
      WHEN algorithm = 'HS512' THEN 'sha512'
      ELSE '' END AS id)  -- hmac throws error
SELECT extensions.url_encode(extensions.hmac(signables, secret, alg.id)) FROM alg;
$$ IMMUTABLE;


CREATE OR REPLACE FUNCTION sign(payload json, secret text, algorithm text DEFAULT 'HS256')
RETURNS text LANGUAGE sql AS $$
WITH
  header AS (
    SELECT extensions.url_encode(convert_to('{"alg":"' || algorithm || '","typ":"JWT"}', 'utf8')) AS data
    ),
  payload AS (
    SELECT extensions.url_encode(convert_to(payload::text, 'utf8')) AS data
    ),
  signables AS (
    SELECT header.data || '.' || payload.data AS data FROM header, payload
    )
SELECT
    signables.data || '.' ||
    extensions.algorithm_sign(signables.data, secret, algorithm) FROM signables;
$$ IMMUTABLE;

CREATE OR REPLACE FUNCTION extensions.try_cast_double(inp text)
RETURNS double precision AS $$
  BEGIN
    BEGIN
      RETURN inp::double precision;
    EXCEPTION
      WHEN OTHERS THEN RETURN NULL;
    END;
  END;
$$ language plpgsql IMMUTABLE;


CREATE OR REPLACE FUNCTION extensions.verify(token text, secret text, algorithm text DEFAULT 'HS256')
RETURNS table(header json, payload json, valid boolean) LANGUAGE sql AS $$
  SELECT
    jwt.header AS header,
    jwt.payload AS payload,
    jwt.signature_ok AND tstzrange(
      to_timestamp(extensions.try_cast_double(jwt.payload->>'nbf')),
      to_timestamp(extensions.try_cast_double(jwt.payload->>'exp'))
    ) @> CURRENT_TIMESTAMP AS valid
  FROM (
    SELECT
      convert_from(extensions.url_decode(r[1]), 'utf8')::json AS header,
      convert_from(extensions.url_decode(r[2]), 'utf8')::json AS payload,
      r[3] = extensions.algorithm_sign(r[1] || '.' || r[2], secret, algorithm) AS signature_ok
    FROM regexp_split_to_array(token, '\.') r
  ) jwt
$$ IMMUTABLE;
