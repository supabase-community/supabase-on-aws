create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

CREATE OR REPLACE FUNCTION extensions.url_encode(data BYTEA)
  RETURNS TEXT LANGUAGE SQL AS $$
SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
$$;

CREATE OR REPLACE FUNCTION extensions.url_decode(data TEXT)
  RETURNS BYTEA LANGUAGE SQL AS $$
WITH t AS (SELECT translate(data, '-_', '+/')),
    rem AS (SELECT length((SELECT *
                           FROM t)) % 4) -- compute padding size
SELECT decode(
    (SELECT *
     FROM t) ||
    CASE WHEN (SELECT *
               FROM rem) > 0
      THEN repeat('=', (4 - (SELECT *
                             FROM rem)))
    ELSE '' END,
    'base64');
$$;


CREATE OR REPLACE FUNCTION extensions.algorithm_sign(signables TEXT, secret TEXT, algorithm TEXT)
  RETURNS TEXT LANGUAGE SQL AS $$
WITH
    alg AS (
      SELECT CASE
             WHEN algorithm = 'HS256'
               THEN 'sha256'
             WHEN algorithm = 'HS384'
               THEN 'sha384'
             WHEN algorithm = 'HS512'
               THEN 'sha512'
             ELSE '' END) -- hmac throws error
SELECT extensions.url_encode(extensions.hmac(signables, secret, (SELECT * FROM alg)));
$$;


CREATE OR REPLACE FUNCTION extensions.sign(payload JSON, secret TEXT, algorithm TEXT DEFAULT 'HS256')
  RETURNS TEXT LANGUAGE SQL AS $$
WITH
    header AS (
      SELECT extensions.url_encode(convert_to('{"alg":"' || algorithm || '","typ":"JWT"}', 'utf8'))
  ),
    payload AS (
      SELECT extensions.url_encode(convert_to(payload :: TEXT, 'utf8'))
  ),
    signables AS (
      SELECT (SELECT *
              FROM header) || '.' || (SELECT * FROM payload)
  )
SELECT (SELECT * FROM signables)
       || '.' ||
       extensions.algorithm_sign((SELECT * FROM signables), secret, algorithm);
$$;


CREATE OR REPLACE FUNCTION extensions.verify(token TEXT, secret TEXT, algorithm TEXT DEFAULT 'HS256')
  RETURNS TABLE(header JSON, payload JSON, valid BOOLEAN) LANGUAGE SQL AS $$
SELECT
  convert_from(extensions.url_decode(r [1]), 'utf8') :: JSON                  AS header,
  convert_from(extensions.url_decode(r [2]), 'utf8') :: JSON                  AS payload,
  r [3] = extensions.algorithm_sign(r [1] || '.' || r [2], secret, algorithm) AS valid
FROM regexp_split_to_array(token, '\.') r;
$$;
