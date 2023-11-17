FROM public.ecr.aws/docker/library/kong:3.5.0 AS build

ARG TARGETPLATFORM
ENV ENVSUBST_VERSION=v1.4.2

USER root

RUN apt-get update && apt-get install -y curl

RUN case ${TARGETPLATFORM} in \
         "linux/amd64")  ENVSUBST_ARCH=Linux-x86_64  ;; \
         "linux/arm64")  ENVSUBST_ARCH=Linux-arm64  ;; \
    esac \
   && curl -L https://github.com/a8m/envsubst/releases/download/${ENVSUBST_VERSION}/envsubst-${ENVSUBST_ARCH} -o /tmp/envsubst \
   && chmod +x /tmp/envsubst

FROM public.ecr.aws/docker/library/kong:3.5.0

WORKDIR /home/kong

COPY --from=build /tmp/envsubst /usr/local/bin/envsubst
COPY ./kong-template.yml /home/kong/tmp.yml

ENV KONG_DATABASE=off \
    KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml

ENTRYPOINT ["bash", "-c", "envsubst -i ~/tmp.yml -o ~/kong.yml && /docker-entrypoint.sh kong docker-start"]
