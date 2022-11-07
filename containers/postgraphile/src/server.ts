import xray from 'aws-xray-sdk';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import fastifyGracefulShutdown from 'fastify-graceful-shutdown';
import fastifyHealth from 'fastify-healthcheck';
import fastifyXray from 'fastify-xray';
import { postgraphile, PostGraphileResponseFastify3, PostGraphileResponse } from 'postgraphile';
import supabaseInflectionPlugin from './custom-plugin/supabase-inflection-plugin';

const port = Number(process.env.PORT || '5000');
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/postgres';
const schema = process.env.DATABASE_SCHEMA || 'public';
const enableXrayTracing = (process.env.ENABLE_XRAY_TRACING == 'true') ? true : false; // default: false

const middleware = postgraphile(databaseUrl, schema, {
  watchPg: (process.env.PG_WATCH == 'false') ? false : true, // default: true,
  graphiql: (process.env.PG_GRAPHIQL == 'false') ? false : true, // default: true
  enhanceGraphiql: (process.env.PG_ENHANCE_GRAPHIQL == 'false') ? false : true, // default: true
  dynamicJson: (process.env.PG_DYNAMIC_JSON == 'false') ? false : true, // default: true
  ignoreRBAC: (process.env.PG_IGNORE_RBAC == 'false') ? false : true, // default: true
  jwtSecret: process.env.JWT_SECRET,
  jwtVerifyOptions: {
    audience: process.env.JWT_VERIFY_AUDIENCE?.split(',') || [],
  },
  appendPlugins: [
    //supabaseInflectionPlugin,
  ],
});

const fastify = Fastify({ logger: true });

fastify.register(fastifyGracefulShutdown).after((err) => console.error(err));
fastify.register(fastifyHealth).after((err) => console.error(err));
fastify.addHook('onRoute', (opts) => {
  if (opts.path === '/health') {
    opts.logLevel = 'error';
  }
});

if (enableXrayTracing) {
  xray.middleware.setSamplingRules({
    rules: [
      {
        description: 'Health check',
        host: '*',
        http_method: 'GET',
        url_path: '/health',
        fixed_target: 0,
        rate: 0.0,
      },
    ],
    default: { fixed_target: 1, rate: 1.0 },
    version: 2,
  });
  xray.config([xray.plugins.ECSPlugin]);
  fastify.register(fastifyXray, { defaultName: 'PostGraphile' }).after((err) => console.error(err));
}

const convertHandler = (handler: (res: PostGraphileResponse) => Promise<void>) => (
  request: FastifyRequest,
  reply: FastifyReply,
) => handler(new PostGraphileResponseFastify3(request, reply));

// OPTIONS requests, for CORS/etc
fastify.options(middleware.graphqlRoute, convertHandler(middleware.graphqlRouteHandler));

// This is the main middleware
fastify.post(middleware.graphqlRoute, convertHandler(middleware.graphqlRouteHandler));

// GraphiQL, if you need it
if (middleware.options.graphiql) {
  if (middleware.graphiqlRouteHandler) {
    fastify.head(middleware.graphiqlRoute, convertHandler(middleware.graphiqlRouteHandler));
    fastify.get(middleware.graphiqlRoute, convertHandler(middleware.graphiqlRouteHandler));
  }
  // Remove this if you don't want the PostGraphile logo as your favicon!
  if (middleware.faviconRouteHandler) {
    fastify.get('/favicon.ico', convertHandler(middleware.faviconRouteHandler));
  }
}

// If you need watch mode, this is the route served by the
if (middleware.options.watchPg) {
  if (middleware.eventStreamRouteHandler) {
    fastify.options(
      middleware.eventStreamRoute,
      convertHandler(middleware.eventStreamRouteHandler),
    );
    fastify.get(middleware.eventStreamRoute, convertHandler(middleware.eventStreamRouteHandler));
  }
}

fastify.listen({ port, host: '0.0.0.0' })
  .then((address) => fastify.log.info(`PostGraphiQL available at ${address}${middleware.graphiqlRoute} 🚀`) )
  .catch(err => fastify.log.error(err) );
