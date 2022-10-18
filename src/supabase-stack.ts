import * as cdk from 'aws-cdk-lib';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ManagedPrefixList } from './aws-prefix-list';
import { Stack as WorkMailStack } from './aws-workmail';
import { ForceDeployJob } from './ecs-force-deploy-job';
import { SupabaseAuth, AuthProvicerName } from './supabase-auth';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseJwt } from './supabase-jwt';
import { SupabaseMail } from './supabase-mail';
import { SupabaseService } from './supabase-service';
import { SupabaseStudio } from './supabase-studio';
import { sesSmtpSupportedRegions } from './utils';

const ecrAlias = 'supabase';
const ecrRegistry = `public.ecr.aws/${ecrAlias}`;
const ecrGalleryUrl = `https://gallery.ecr.aws/${ecrAlias}`;
const imageTagPattern = '^(v[0-9]+.[0-9]+.[0-9]+(.\w)*)|latest$'; // for docker image tags

interface SupabaseStackProps extends cdk.StackProps {
  gqlEnabled?: boolean;
}

export class SupabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SupabaseStackProps = {}) {
    super(scope, id, props);

    const { gqlEnabled } = props;

    // Mappings
    const fargateTaskSize = new cdk.CfnMapping(this, 'FargateTaskSize', {
      mapping: {
        'nano': { cpu: 256, memory: 512 },
        'micro': { cpu: 256, memory: 1024 },
        'small': { cpu: 512, memory: 1024 },
        'medium': { cpu: 1024, memory: 2048 },
        'large': { cpu: 2048, memory: 4096 },
        'xlarge': { cpu: 4096, memory: 8192 },
        '2xlarge': { cpu: 8192, memory: 16384 },
        '4xlarge': { cpu: 16384, memory: 32768 },
      },
    });
    const allowedFargateTaskSize = ['nano', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge'];

    // Parameters
    const disableSignup = new cdk.CfnParameter(this, 'DisableSignup', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const siteUrl = new cdk.CfnParameter(this, 'SiteUrl', {
      description: 'The base URL your site is located at. Currently used in combination with other settings to construct URLs used in emails.',
      type: 'String',
      default: 'http://localhost:3000',
    });

    const redirectUrls = new cdk.CfnParameter(this, 'RedirectUrls', {
      description: 'URLs that auth providers are permitted to redirect to post authentication',
      type: 'String',
      default: '',
    });

    const jwtExpiryLimit = new cdk.CfnParameter(this, 'JwtExpiryLimit', {
      description: 'How long tokens are valid for. Defaults to 3600 (1 hour), maximum 604,800 seconds (one week).',
      type: 'Number',
      default: 3600,
      minValue: 300,
      maxValue: 604800,
    });

    const passwordMinLength = new cdk.CfnParameter(this, 'PasswordMinLength', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'Number',
      default: '16',
      minValue: 8,
      maxValue: 128,
    });

    const senderEmail = new cdk.CfnParameter(this, 'SenderEmail', {
      description: 'This is the email address the emails are sent from. If Amazon WorkMail is enabled, it set "noreply@supabase-<account_id>.awsapps.com"',
      type: 'String',
      default: 'noreply@example.com',
      allowedPattern: '^[\\x20-\\x45]?[\\w-\\+]+(\\.[\\w]+)*@[\\w-]+(\\.[\\w]+)*(\\.[a-z]{2,})$',
      constraintDescription: 'must be a valid email address',
    });

    const senderName = new cdk.CfnParameter(this, 'SenderName', {
      description: 'The From email sender name for all emails sent.',
      type: 'String',
      default: 'Supabase',
    });

    const sesRegion = new cdk.CfnParameter(this, 'SesRegion', {
      description: 'Use Amazon SES as SMTP server. If Amazon WorkMail is enabled, Please set us-east-1, us-west-2 or eu-west-1',
      type: 'String',
      default: 'us-west-2',
      allowedValues: sesSmtpSupportedRegions,
    });

    const enableWorkMail = new cdk.CfnParameter(this, 'EnableWorkMail', {
      description: 'Enable Amazon WorkMail. To use "supabase-<account_id>.awsapps.com" domain with Amazon SES.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const wafRequestRateLimit = new cdk.CfnParameter(this, 'WafRequestRateLimit', {
      description: 'The rate limit is the maximum number of requests from a single IP address that are allowed in a five-minute period. This value is continually evaluated, and requests will be blocked once this limit is reached. The IP address is automatically unblocked after it falls below the limit.',
      type: 'Number',
      default: 30000,
      minValue: 100,
      maxValue: 20000000,
    });

    const dbMultiAz = new cdk.CfnParameter(this, 'DatabaseMultiAz', {
      description: 'Create a replica at another Availability Zone',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const minAcu = new cdk.CfnParameter(this, 'MinAuroraCapacityUnit', {
      description: 'The minimum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.',
      type: 'Number',
      default: 0.5,
      minValue: 0.5,
      maxValue: 128,
    });

    const maxAcu = new cdk.CfnParameter(this, 'MaxAuroraCapacityUnit', {
      description: 'The maximum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.',
      type: 'Number',
      default: 32,
      minValue: 0.5,
      maxValue: 128,
    });

    const kongTaskSize = new cdk.CfnParameter(this, 'KongTaskSize', {
      description: 'Fargare task size for API Gateway (Kong)',
      type: 'String',
      default: 'medium',
      allowedValues: allowedFargateTaskSize,
    });
    const kongMinTasks = new cdk.CfnParameter(this, 'KongMinTasks', {
      description: 'Minimum fargate task count for API Gateway (Kong)',
      type: 'Number',
      default: 1,
      minValue: 1,
    });
    const kongMaxTasks = new cdk.CfnParameter(this, 'KongMaxTasks', {
      description: 'Maximum fargate task count for API Gateway (Kong)',
      type: 'Number',
      default: 20,
      minValue: 1,
    });

    const authTaskSize = new cdk.CfnParameter(this, 'AuthTaskSize', {
      description: 'Fargare task size for Auth API (GoTrue)',
      type: 'String',
      default: 'medium',
      allowedValues: allowedFargateTaskSize,
    });
    const authMinTasks = new cdk.CfnParameter(this, 'AuthMinTasks', {
      description: 'Minimum fargate task count for Auth API (GoTrue)',
      type: 'Number',
      default: 1,
      minValue: 1,
    });
    const authMaxTasks = new cdk.CfnParameter(this, 'AuthMaxTasks', {
      description: 'Maximum fargate task count for Auth API (GoTrue)',
      type: 'Number',
      default: 20,
      minValue: 1,
    });

    const restTaskSize = new cdk.CfnParameter(this, 'RestTaskSize', {
      description: 'Fargare task size for Rest API (PostgREST)',
      type: 'String',
      default: 'medium',
      allowedValues: allowedFargateTaskSize,
    });
    const restMinTasks = new cdk.CfnParameter(this, 'RestMinTasks', {
      description: 'Minimum fargate task count for Rest API (PostgREST)',
      type: 'Number',
      default: 1,
      minValue: 1,
    });
    const restMaxTasks = new cdk.CfnParameter(this, 'RestMaxTasks', {
      description: 'Maximum fargate task count for Rest API (PostgREST)',
      type: 'Number',
      default: 20,
      minValue: 1,
    });

    const realtimeTaskSize = new cdk.CfnParameter(this, 'RealtimeTaskSize', {
      description: 'Fargare task size for Realtime API)',
      type: 'String',
      default: 'medium',
      allowedValues: allowedFargateTaskSize,
    });
    //const realtimeMinTasks = new cdk.CfnParameter(this, 'RealtimeMinTasks', {
    //  description: 'Minimum fargate task count for Realtime API',
    //  type: 'Number',
    //  default: 1,
    //  minValue: 1,
    //});
    //const realtimeMaxTasks = new cdk.CfnParameter(this, 'RealtimeMaxTasks', {
    //  description: 'Maximum fargate task count for Realtime API',
    //  type: 'Number',
    //  default: 1,
    //  minValue: 1,
    //});

    const storageTaskSize = new cdk.CfnParameter(this, 'StorageTaskSize', {
      description: 'Fargare task size for Storage API',
      type: 'String',
      default: 'medium',
      allowedValues: allowedFargateTaskSize,
    });
    const storageMinTasks = new cdk.CfnParameter(this, 'StorageMinTasks', {
      description: 'Minimum fargate task count for Storage API',
      type: 'Number',
      default: 1,
      minValue: 1,
    });
    const storageMaxTasks = new cdk.CfnParameter(this, 'StorageMaxTasks', {
      description: 'Maximum fargate task count for Storage API',
      type: 'Number',
      default: 20,
      minValue: 1,
    });

    const postgresMetaTaskSize = new cdk.CfnParameter(this, 'PostgresMetaTaskSize', {
      description: 'Fargare task size for PostgresMeta API',
      type: 'String',
      default: 'nano',
      allowedValues: allowedFargateTaskSize,
    });
    const postgresMetaMinTasks = new cdk.CfnParameter(this, 'PostgresMetaMinTasks', {
      description: 'Minimum fargate task count for PostgresMeta API',
      type: 'Number',
      default: 1,
      minValue: 1,
    });
    const postgresMetaMaxTasks = new cdk.CfnParameter(this, 'PostgresMetaMaxTasks', {
      description: 'Maximum fargate task count for PostgresMeta API',
      type: 'Number',
      default: 20,
      minValue: 1,
    });

    const authApiVersion = new cdk.CfnParameter(this, 'AuthApiVersion', {
      type: 'String',
      default: 'v2.18.1',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/gotrue`,
    });
    const restApiVersion = new cdk.CfnParameter(this, 'RestApiVersion', {
      type: 'String',
      default: 'v9.0.1.20220802',
      description: `Docker image tag - ${ecrGalleryUrl}/postgrest`,
    });
    const realtimeApiVersion = new cdk.CfnParameter(this, 'RealtimeApiVersion', {
      type: 'String',
      default: 'v0.24.2',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/realtime`,
    });
    const storageApiVersion = new cdk.CfnParameter(this, 'StorageApiVersion', {
      type: 'String',
      default: 'v0.23.1',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/storage-api`,
    });
    const postgresMetaApiVersion = new cdk.CfnParameter(this, 'PostgresMetaApiVersion', {
      type: 'String',
      default: 'v0.50.2',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/postgres-meta`,
    });

    // Condition
    const workMailEnabled = new cdk.CfnCondition(this, 'WorkMailEnabled', { expression: cdk.Fn.conditionEquals(enableWorkMail, 'true') });
    const dbMultiAzEnabled = new cdk.CfnCondition(this, 'DatabaseMultiAzEnabled', { expression: cdk.Fn.conditionEquals(dbMultiAz, 'true') });

    // Resources
    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    new cdk.CfnRule(this, 'CheckWorkMailRegion', {
      ruleCondition: workMailEnabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionContains(['us-east-1', 'us-west-2', 'eu-west-1'], sesRegion.valueAsString),
        assertDescription: 'Amazon WorkMail is supported only in us-east-1, us-west-2 or eu-west-1. Please change Amazon SES Region.',
      }],
    });

    const workMail = new WorkMailStack(this, 'WorkMail', { region: sesRegion.valueAsString, alias: `supabase-${cdk.Aws.ACCOUNT_ID}` });
    workMail.organization.addUser('Noreply');
    (workMail.node.defaultChild as cdk.CfnStack).addOverride('Condition', workMailEnabled.logicalId);

    const smtpAdminEmail = cdk.Fn.conditionIf(workMailEnabled.logicalId, `noreply@${workMail.organization.domain}`, senderEmail.valueAsString);
    const smtpHost = `email-smtp.${sesRegion.valueAsString}.amazonaws.com`;

    const mail = new SupabaseMail(this, 'SupabaseMail', { region: sesRegion.valueAsString });

    const db = new SupabaseDatabase(this, 'Database', { vpc, multiAzEnabled: dbMultiAzEnabled, minCapacity: minAcu.valueAsNumber, maxCapacity: maxAcu.valueAsNumber });

    const jwt = new SupabaseJwt(this, 'SupabaseJwt', { issuer: 'supabase', expiresIn: '10y' });

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/kong:latest'),
        //image: ecs.ContainerImage.fromAsset('./src/containers/kong', { platform: Platform.LINUX_ARM64 }),
        containerPort: 8000,
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl,opentelemetry',
          KONG_STATUS_LISTEN: '0.0.0.0:8100',
          //KONG_OPENTELEMETRY_ENABLED: 'true',
          //KONG_OPENTELEMETRY_TRACING: 'all',
          //KONG_OPENTELEMETRY_TRACING_SAMPLING_RATE: '1.0',
          //OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://${jaeger.dnsName}:4318/v1/traces`,
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(jwt.anonKey),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(jwt.serviceRoleKey),
        },
        healthCheck: {
          command: ['CMD', 'kong', 'health'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
      taskSpec: {
        cpu: fargateTaskSize.findInMap(kongTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(kongTaskSize.valueAsString, 'memory'),
        minTasks: kongMinTasks.valueAsNumber,
        maxTasks: kongMaxTasks.valueAsNumber,
      },
    });
    const kongLoadBalancer = kong.addNetworkLoadBalancer({ healthCheckPort: 8100 });

    const cfPrefixList = new ManagedPrefixList(this, 'CloudFrontManagedPrefixList', { name: 'com.amazonaws.global.cloudfront.origin-facing' });
    kong.ecsService.connections.allowFrom(Peer.prefixList(cfPrefixList.prefixListId), Port.tcp(kong.listenerPort), 'CloudFront');

    const cdn = new SupabaseCdn(this, 'Cdn', { origin: kongLoadBalancer, requestRateLimit: wafRequestRateLimit.valueAsNumber });
    const apiExternalUrl = `https://${cdn.distribution.domainName}`;

    const auth = new SupabaseAuth(this, 'Auth', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/gotrue:${authApiVersion.valueAsString}`),
        containerPort: 9999,
        environment: {
          // Top-Level - https://github.com/supabase/gotrue#top-level
          GOTRUE_SITE_URL: siteUrl.valueAsString,
          GOTRUE_URI_ALLOW_LIST: redirectUrls.valueAsString,
          GOTRUE_DISABLE_SIGNUP: disableSignup.valueAsString,
          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', // Amazon SNS not supported
          GOTRUE_RATE_LIMIT_EMAIL_SENT: '3600', // SES Limit: 1msg/s
          GOTRUE_PASSWORD_MIN_LENGTH: passwordMinLength.valueAsString,
          // API - https://github.com/supabase/gotrue#api
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          API_EXTERNAL_URL: apiExternalUrl,
          // Database - https://github.com/supabase/gotrue#database
          GOTRUE_DB_DRIVER: 'postgres',
          // Observability
          //GOTRUE_TRACING_ENABLED: 'true',
          //OTEL_SERVICE_NAME: 'gotrue',
          //OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
          //OTEL_EXPORTER_OTLP_ENDPOINT: `http://${jaeger.dnsName}:4317`,
          // JWT - https://github.com/supabase/gotrue#json-web-tokens-jwt
          GOTRUE_JWT_EXP: jwtExpiryLimit.valueAsString,
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          // E-Mail - https://github.com/supabase/gotrue#e-mail
          GOTRUE_SMTP_ADMIN_EMAIL: smtpAdminEmail.toString(),
          GOTRUE_SMTP_HOST: smtpHost.toString(),
          GOTRUE_SMTP_PORT: '465',
          GOTRUE_SMTP_SENDER_NAME: senderName.valueAsString,
          GOTRUE_MAILER_AUTOCONFIRM: 'false',
          GOTRUE_MAILER_URLPATHS_INVITE: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',
          // Phone Auth - https://github.com/supabase/gotrue#phone-auth
          GOTRUE_SMS_AUTOCONFIRM: 'true',
        },
        secrets: {
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writerSearchPathAuth),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(mail.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(mail.secret, 'password'),
        },
        healthCheck: {
          command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:9999/health || exit 1'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
      taskSpec: {
        cpu: fargateTaskSize.findInMap(authTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(authTaskSize.valueAsString, 'memory'),
        minTasks: authMinTasks.valueAsNumber,
        maxTasks: authMaxTasks.valueAsNumber,
      },
    });
    auth.addExternalAuthProvider('Google');
    auth.addExternalAuthProvider('Facebook');
    auth.addExternalAuthProvider('Twitter');
    auth.addExternalAuthProvider('GitHub');

    const rest = new SupabaseService(this, 'Rest', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`postgrest/postgrest:${restApiVersion.valueAsString}`),
        containerPort: 3000,
        environment: {
          PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_USE_LEGACY_GUCS: 'false',
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSsmParameter(db.url.writer),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
        },
      },
      taskSpec: {
        cpu: fargateTaskSize.findInMap(restTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(restTaskSize.valueAsString, 'memory'),
        minTasks: restMinTasks.valueAsNumber,
        maxTasks: restMaxTasks.valueAsNumber,
      },
    });

    if (gqlEnabled) {
      // GraphQL - use postgraphile insted of pg_graphql
      const graphql = new SupabaseService(this, 'GraphQL', {
        cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/postgraphile:latest'),
          //image: ecs.ContainerImage.fromAsset('./src/containers/postgraphile', { platform: Platform.LINUX_ARM64 }),
          containerPort: 5000,
          //healthCheck: {
          //  command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1'],
          //  interval: cdk.Duration.seconds(5),
          //  timeout: cdk.Duration.seconds(5),
          //  retries: 3,
          //},
          environment: {
            PG_IGNORE_RBAC: '0',
            ENABLE_XRAY_TRACING: '1',
          },
          secrets: {
            DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writer),
            JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          },
        },
        taskSpec: {
          cpu: fargateTaskSize.findInMap(restTaskSize.valueAsString, 'cpu'),
          memory: fargateTaskSize.findInMap(restTaskSize.valueAsString, 'memory'),
          minTasks: restMinTasks.valueAsNumber,
          maxTasks: restMaxTasks.valueAsNumber,
        },
      });
      graphql.addDatabaseBackend(db);
      kong.addBackend(graphql);
      kong.ecsService.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_GRAPHQL_URL', 'http://graphql.supabase.local:5000/graphql');
    }

    const realtime = new SupabaseService(this, 'Realtime', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/realtime:${realtimeApiVersion.valueAsString}`),
        containerPort: 4000,
        environment: {
          DB_SSL: 'false',
          PORT: '4000',
          REPLICATION_MODE: 'RLS',
          REPLICATION_POLL_INTERVAL: '300', // for RLS
          SUBSCRIPTION_SYNC_INTERVAL: '60000', // for RLS
          SECURE_CHANNELS: 'true',
          SLOT_NAME: 'realtime_rls',
          TEMPORARY_SLOT: 'true',
          MAX_REPLICATION_LAG_MB: '1000',
        },
        secrets: {
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          DB_HOST: ecs.Secret.fromSecretsManager(db.secret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(db.secret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(db.secret, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(db.secret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret, 'password'),
        },
        command: ['bash', '-c', './prod/rel/realtime/bin/realtime eval Realtime.Release.migrate && ./prod/rel/realtime/bin/realtime start'],
      },
      taskSpec: {
        cpu: fargateTaskSize.findInMap(realtimeTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(realtimeTaskSize.valueAsString, 'memory'),
        //minTasks: realtimeMinTasks.valueAsNumber,
        //maxTasks: realtimeMaxTasks.valueAsNumber,
      },
    });

    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const storage = new SupabaseService(this, 'Storage', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/storage-api:${storageApiVersion.valueAsString}`),
        containerPort: 5000,
        environment: {
          POSTGREST_URL: 'http://rest.supabase.local:3000',
          PGOPTIONS: '-c search_path=storage,public',
          FILE_SIZE_LIMIT: '52428800',
          STORAGE_BACKEND: 's3', // default: file
          TENANT_ID: 'default',
          REGION: bucket.env.region,
          GLOBAL_S3_BUCKET: bucket.bucketName,
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(jwt.anonKey),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(jwt.serviceRoleKey),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writer),
        },
        healthCheck: {
          command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:5000/status || exit 1'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
      taskSpec: {
        cpuArchitecture: 'x86_64', // storage-api does not work on ARM64
        cpu: fargateTaskSize.findInMap(storageTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(storageTaskSize.valueAsString, 'memory'),
        minTasks: storageMinTasks.valueAsNumber,
        maxTasks: storageMaxTasks.valueAsNumber,
      },
    });
    bucket.grantReadWrite(storage.ecsService.taskDefinition.taskRole);

    const meta = new SupabaseService(this, 'Meta', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/postgres-meta:${postgresMetaApiVersion.valueAsString}`),
        containerPort: 8080,
        environment: {
          PG_META_PORT: '8080',
        },
        secrets: {
          PG_META_DB_HOST: ecs.Secret.fromSecretsManager(db.secret, 'host'),
          PG_META_DB_PORT: ecs.Secret.fromSecretsManager(db.secret, 'port'),
          PG_META_DB_NAME: ecs.Secret.fromSecretsManager(db.secret, 'dbname'),
          PG_META_DB_USER: ecs.Secret.fromSecretsManager(db.secret, 'username'),
          PG_META_DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret, 'password'),
        },
      },
      taskSpec: {
        cpu: fargateTaskSize.findInMap(postgresMetaTaskSize.valueAsString, 'cpu'),
        memory: fargateTaskSize.findInMap(postgresMetaTaskSize.valueAsString, 'memory'),
        minTasks: postgresMetaMinTasks.valueAsNumber,
        maxTasks: postgresMetaMaxTasks.valueAsNumber,
      },
    });

    kong.addBackend(auth);
    kong.addBackend(rest);
    kong.addBackend(realtime);
    kong.addBackend(storage);
    kong.addBackend(meta);

    auth.addBackend(rest);
    storage.addBackend(rest);

    auth.addDatabaseBackend(db);
    rest.addDatabaseBackend(db);
    realtime.addDatabaseBackend(db);
    storage.addDatabaseBackend(db);
    meta.addDatabaseBackend(db);

    // Supabase Studio
    const studioVersion = new cdk.CfnParameter(this, 'StudioVersion', {
      type: 'String',
      default: 'latest',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/studio`,
    });

    const studio = new SupabaseStudio(this, 'Studio', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/studio:${studioVersion.valueAsString}`),
        containerPort: 3000,
        environment: {
          STUDIO_PG_META_URL: `${apiExternalUrl}/pg`,
          SUPABASE_URL: `${apiExternalUrl}`, // for API Docs
          SUPABASE_REST_URL: `${apiExternalUrl}/rest/v1/`,
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(db.secret, 'password'),
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(jwt.anonKey),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(jwt.serviceRoleKey),
        },
      },
    });

    const forceDeployJob = new ForceDeployJob(this, 'ForceDeployJob', { cluster });

    const dbSecretRotatedRule = new events.Rule(this, 'DatabaseSecretRotated', {
      description: 'Supabase - Database secret rotated',
      eventPattern: {
        source: ['aws.secretsmanager'],
        detail: {
          eventName: ['RotationSucceeded'],
          additionalEventData: {
            SecretId: [db.secret.secretArn],
          },
        },
      },
    });

    const authParameterChangedRule = new events.Rule(this, 'AuthParameterChanged', {
      description: 'Supabase - Auth parameter changed',
      eventPattern: {
        source: ['aws.ssm'],
        detailType: ['Parameter Store Change'],
        detail: {
          name: [{ prefix: `/${cdk.Aws.STACK_NAME}/${auth.node.id}/` }],
          operation: ['Update'],
        },
      },
    });

    forceDeployJob.addTrigger({ rule: dbSecretRotatedRule, services: [auth, rest, realtime, storage, meta, studio] });
    forceDeployJob.addTrigger({ rule: authParameterChangedRule, services: [auth] });

    this.exportValue(jwt.anonToken, { name: 'ApiKey' });
    this.exportValue(apiExternalUrl, { name: 'Url' });
    new cdk.CfnOutput(this, 'StudioUrl', { value: `http://${studio.loadBalancer.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'StudioUserPool', { value: `https://${cdk.Aws.REGION}.console.aws.amazon.com/cognito/v2/idp/user-pools/${studio.userPool.userPoolId}/users` });

    const cfnInterface = {
      ParameterGroups: [
        {
          Label: { default: 'Supabase - Auth Settings' },
          Parameters: [
            disableSignup.logicalId,
            siteUrl.logicalId,
            redirectUrls.logicalId,
            jwtExpiryLimit.logicalId,
            passwordMinLength.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - Auth E-mail Settings' },
          Parameters: [
            senderEmail.logicalId,
            senderName.logicalId,
            sesRegion.logicalId,
            enableWorkMail.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Security' },
          Parameters: [
            wafRequestRateLimit.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Database' },
          Parameters: [
            dbMultiAz.logicalId,
            minAcu.logicalId,
            maxAcu.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - API Gateway (Kong)' },
          Parameters: [
            kongTaskSize.logicalId,
            kongMinTasks.logicalId,
            kongMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Auth API (GoTrue)' },
          Parameters: [
            authApiVersion.logicalId,
            authTaskSize.logicalId,
            authMinTasks.logicalId,
            authMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Rest API (PostgREST)' },
          Parameters: [
            restApiVersion.logicalId,
            restTaskSize.logicalId,
            restMinTasks.logicalId,
            restMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Realtime API' },
          Parameters: [
            realtimeApiVersion.logicalId,
            realtimeTaskSize.logicalId,
            //realtimeMinTasks.logicalId,
            //realtimeMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Storage API' },
          Parameters: [
            storageApiVersion.logicalId,
            storageTaskSize.logicalId,
            storageMinTasks.logicalId,
            storageMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Postgres Meta API' },
          Parameters: [
            postgresMetaApiVersion.logicalId,
            postgresMetaTaskSize.logicalId,
            postgresMetaMinTasks.logicalId,
            postgresMetaMaxTasks.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure - Supabase Studio' },
          Parameters: [
            studioVersion.logicalId,
            studio.acmCertArn.logicalId,
          ],
        },
      ],
      ParameterLabels: {
        [disableSignup.logicalId]: { default: 'Disable User Signups' },
        [siteUrl.logicalId]: { default: 'Site URL' },
        [redirectUrls.logicalId]: { default: 'Redirect URLs' },
        [jwtExpiryLimit.logicalId]: { default: 'JWT expiry limit' },
        [passwordMinLength.logicalId]: { default: 'Min password length' },
        [senderEmail.logicalId]: { default: 'Sender Email Address' },
        [senderName.logicalId]: { default: 'Sender Name' },
        [sesRegion.logicalId]: { default: 'Amazon SES Region' },
        [enableWorkMail.logicalId]: { default: 'Enable Amazon WorkMail (Test E-mail Domain)' },
        [wafRequestRateLimit.logicalId]: { default: 'WAF Request Rate Limit' },

        [dbMultiAz.logicalId]: { default: 'Database Multi-AZ' },
        [minAcu.logicalId]: { default: 'Minimum Aurora Capacity Units' },
        [maxAcu.logicalId]: { default: 'Maximum Aurora Capacity Units' },

        [kongTaskSize.logicalId]: { default: 'Fargate Task Size' },
        [kongMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        [kongMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [authApiVersion.logicalId]: { default: 'Auth API Version - GoTrue' },
        [authTaskSize.logicalId]: { default: 'Fargate Task Size' },
        [authMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        [authMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [restApiVersion.logicalId]: { default: 'Rest API Version - PostgREST' },
        [restTaskSize.logicalId]: { default: 'Fargate Task Size' },
        [restMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        [restMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [realtimeApiVersion.logicalId]: { default: 'Realtime API Version' },
        [realtimeTaskSize.logicalId]: { default: 'Fargate Task Size' },
        //[realtimeMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        //[realtimeMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [storageApiVersion.logicalId]: { default: 'Storage API Version' },
        [storageTaskSize.logicalId]: { default: 'Fargate Task Size' },
        [storageMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        [storageMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [postgresMetaApiVersion.logicalId]: { default: 'Postgres Meta API Version' },
        [postgresMetaTaskSize.logicalId]: { default: 'Fargate Task Size' },
        [postgresMetaMinTasks.logicalId]: { default: 'Minimum Fargate Task Count' },
        [postgresMetaMaxTasks.logicalId]: { default: 'Maximum Fargate Task Count' },

        [studioVersion.logicalId]: { default: 'Supabase Studio Version' },
        [studio.acmCertArn.logicalId]: { default: 'ACM Certificate ARN' },
      },
    };

    for (let provicerName in auth.externalAuthProvider) {
      const provider = auth.externalAuthProvider[provicerName as AuthProvicerName];
      if (typeof provider != 'undefined') {
        cfnInterface.ParameterGroups.push({
          Label: { default: `External Auth Provider - ${provider.name}` },
          Parameters: [
            provider.enabled.logicalId,
            provider.clientId.logicalId,
            provider.secret.logicalId,
          ],
        });
        cfnInterface.ParameterLabels[provider.enabled.logicalId] = { default: `${provider.name} Enabled` };
        cfnInterface.ParameterLabels[provider.clientId.logicalId] = { default: `${provider.name} Client ID` };
        cfnInterface.ParameterLabels[provider.secret.logicalId] = { default: `${provider.name} Client Secret` };
      }
    }

    // for CloudFormation
    this.templateOptions.description = 'Self-hosted Supabase';
    this.templateOptions.metadata = { 'AWS::CloudFormation::Interface': cfnInterface };

  }
}
