#!/bin/bash
# Custom entrypoint for Kong — HS256-only (no opaque key translation).
# Substitutes environment variables in the declarative config.

# Uses awk instead of eval/echo to preserve YAML quoting (eval strips double
# quotes, breaking "Header: value" patterns that YAML parses as mappings).
awk '{
  result = ""
  rest = $0
  while (match(rest, /\$[A-Za-z_][A-Za-z_0-9]*/)) {
    varname = substr(rest, RSTART + 1, RLENGTH - 1)
    if (varname in ENVIRON) {
      result = result substr(rest, 1, RSTART - 1) ENVIRON[varname]
    } else {
      result = result substr(rest, 1, RSTART + RLENGTH - 1)
    }
    rest = substr(rest, RSTART + RLENGTH)
  }
  print result rest
}' /home/kong/temp.yml > "$KONG_DECLARATIVE_CONFIG"

exec /entrypoint.sh kong docker-start
