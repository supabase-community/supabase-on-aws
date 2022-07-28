FROM --platform=linux/amd64 public.ecr.aws/docker/library/kong:2.8 AS build

USER root

RUN apk update && apk add curl
RUN curl -L https://github.com/a8m/envsubst/releases/download/v1.2.0/envsubst-Linux-arm64 -o /tmp/envsubst && chmod +x /tmp/envsubst
RUN sed -i 1a"envsubst -i /home/kong/kong-template.yml -o /home/kong/kong.yml" /docker-entrypoint.sh

FROM public.ecr.aws/docker/library/kong:2.8

COPY --from=build /tmp/envsubst /usr/local/bin/envsubst
COPY --from=build /docker-entrypoint.sh /docker-entrypoint.sh
COPY ./kong-template.yml /home/kong/kong-template.yml

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml
