FROM kong/kong:3.9.1

COPY kong.yml /home/kong/temp.yml
COPY kong-entrypoint.sh /home/kong/kong-entrypoint.sh

USER root
RUN chmod +x /home/kong/kong-entrypoint.sh
USER kong

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/usr/local/kong/kong.yml

ENTRYPOINT ["/home/kong/kong-entrypoint.sh"]
