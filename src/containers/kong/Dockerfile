FROM --platform=linux/amd64 public.ecr.aws/docker/library/kong:3.0 AS build

ARG TARGETPLATFORM
ENV ENVSUBST_VERSION=v1.2.0

USER root

RUN apk update && apk add curl

RUN case ${TARGETPLATFORM} in \
         "linux/amd64")  ENVSUBST_ARCH=Linux-x86_64  ;; \
         "linux/arm64")  ENVSUBST_ARCH=Linux-arm64  ;; \
    esac \
   && curl -L https://github.com/a8m/envsubst/releases/download/${ENVSUBST_VERSION}/envsubst-${ENVSUBST_ARCH} -o /tmp/envsubst \
   && chmod +x /tmp/envsubst

RUN sed -i 1a"envsubst -i /home/kong/kong-template.yml -o /home/kong/kong.yml" /docker-entrypoint.sh

FROM public.ecr.aws/docker/library/kong:3.0

COPY --from=build /tmp/envsubst /usr/local/bin/envsubst
COPY --from=build /docker-entrypoint.sh /docker-entrypoint.sh
COPY ./kong-template.yml /home/kong/kong-template.yml

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml
