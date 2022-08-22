FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:18-alpine AS build

WORKDIR /postgraphile/
COPY package.json ./
RUN npm install

COPY ./src ./src
COPY tsconfig.json ./
RUN npm run build

FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:18-alpine AS module

WORKDIR /postgraphile/
COPY package.json ./
RUN npm install --production --cache /tmp/empty-cache && rm -rf /tmp/empty-cache

FROM public.ecr.aws/docker/library/node:18-alpine

WORKDIR /postgraphile/
COPY package.json ./
COPY --from=module /postgraphile/node_modules/ ./node_modules/
COPY --from=build /postgraphile/lib/ ./

ENV AWS_XRAY_CONTEXT_MISSING=LOG_ERROR

#HEALTHCHECK --interval=5s --timeout=3s CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

EXPOSE 5000
CMD [ "node", "--require", "module-alias/register", "server.js" ]
