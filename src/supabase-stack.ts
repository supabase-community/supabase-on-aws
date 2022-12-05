import * as cdk from 'aws-cdk-lib';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Smtp } from './amazon-ses-smtp';
import { AmplifyHosting } from './aws-amplify-hosting';
import { PrefixList } from './aws-prefix-list';
import { ForceDeployJob } from './ecs-force-deploy-job';
import { AutoScalingFargateService } from './ecs-patterns';
import { JwtSecret } from './json-web-token';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';

export class FargateStack extends cdk.Stack {
  readonly taskSizeMapping: cdk.CfnMapping;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    this.taskSizeMapping = new cdk.CfnMapping(this, 'TaskSize', {
      mapping: {
        'micro': { cpu: 256, memory: 1024 },
        'small': { cpu: 512, memory: 1024 },
        'medium': { cpu: 1024, memory: 2048 },
        'large': { cpu: 2048, memory: 4096 },
        'xlarge': { cpu: 4096, memory: 8192 },
        '2xlarge': { cpu: 8192, memory: 16384 },
        '4xlarge': { cpu: 16384, memory: 32768 },
      },
    });
  }
}

export class SupabaseStack extends FargateStack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

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
      default: '8',
      minValue: 8,
      maxValue: 128,
    });

    const senderName = new cdk.CfnParameter(this, 'SenderName', {
      description: 'The From email sender name for all emails sent.',
      type: 'String',
      default: 'Supabase',
    });

    const authImageUri = new cdk.CfnParameter(this, 'AuthImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/gotrue:v2.37.2',
      description: 'https://gallery.ecr.aws/supabase/gotrue',
    });
    const restImageUri = new cdk.CfnParameter(this, 'RestImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/postgrest:v9.0.1.20220802',
      description: 'https://gallery.ecr.aws/supabase/postgrest',
    });
    const realtimeImageUri = new cdk.CfnParameter(this, 'RealtimeImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/realtime:v0.25.1',
      description: 'https://gallery.ecr.aws/supabase/realtime',
    });
    const storageImageUri = new cdk.CfnParameter(this, 'StorageImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/storage-api:v0.25.1',
      description: 'https://gallery.ecr.aws/supabase/storage-api',
    });
    const postgresMetaImageUri = new cdk.CfnParameter(this, 'PostgresMetaImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/postgres-meta:v0.52.1',
      description: 'https://gallery.ecr.aws/supabase/postgres-meta',
    });

    const namespaceName = new cdk.CfnParameter(this, 'NamespaceName', {
      type: 'String',
      default: 'supabase.local',
    });

    // Resources
    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      vpc,
    });

    const namespace = cluster.addDefaultCloudMapNamespace({ name: namespaceName.valueAsString });

    const smtp = new Smtp(this, 'Smtp');

    const db = new SupabaseDatabase(this, 'Database', { vpc });

    const jwtSecret = new JwtSecret(this, 'JwtSecret');
    const anonKey = jwtSecret.genApiKey('AnonKey', { roleName: 'anon', issuer: 'supabase', expiresIn: '10y' });
    const serviceRoleKey = jwtSecret.genApiKey('ServiceRoleKey', { roleName: 'service_role', issuer: 'supabase', expiresIn: '10y' });

    const kong = new AutoScalingFargateService(this, 'Kong', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/kong:latest'),
        //image: ecs.ContainerImage.fromAsset('./containers/kong', { platform: Platform.LINUX_ARM64 }),
        containerPort: 8000,
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl,opentelemetry',
          KONG_STATUS_LISTEN: '0.0.0.0:8100',
          //KONG_OPENTELEMETRY_ENABLED: 'true',
          //KONG_OPENTELEMETRY_TRACING: 'all',
          //KONG_OPENTELEMETRY_TRACING_SAMPLING_RATE: '1.0',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
        },
        healthCheck: {
          command: ['CMD', 'kong', 'health'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
    });
    const kongLoadBalancer = kong.addApplicationLoadBalancer({
      healthCheck: {
        port: '8100',
        path: '/status',
        timeout: cdk.Duration.seconds(2),
        interval: cdk.Duration.seconds(5),
      },
    });

    const cfPrefixList = new PrefixList(this, 'CloudFrontPrefixList', { prefixListName: 'com.amazonaws.global.cloudfront.origin-facing' });
    kongLoadBalancer.connections.allowFrom(Peer.prefixList(cfPrefixList.prefixListId), Port.tcp(80), 'CloudFront');

    const cdn = new SupabaseCdn(this, 'Cdn', { origin: kongLoadBalancer });
    const apiExternalUrl = `https://${cdn.distribution.domainName}`;

    const auth = new AutoScalingFargateService(this, 'Auth', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(authImageUri.valueAsString),
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
          GOTRUE_SMTP_ADMIN_EMAIL: smtp.email,
          GOTRUE_SMTP_HOST: smtp.host,
          GOTRUE_SMTP_PORT: smtp.port.toString(),
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
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writerAuth),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(smtp.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(smtp.secret, 'password'),
        },
        healthCheck: {
          command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:9999/health || exit 1'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
    });
    const authProviders = auth.addExternalAuthProviders(`${apiExternalUrl}/auth/v1/callback`, 3);

    const rest = new AutoScalingFargateService(this, 'Rest', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(restImageUri.valueAsString),
        containerPort: 3000,
        environment: {
          PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_USE_LEGACY_GUCS: 'false',
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSsmParameter(db.url.writer),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        },
      },
    });

    const gql = new AutoScalingFargateService(this, 'GraphQL', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/postgraphile:latest'),
        //image: ecs.ContainerImage.fromAsset('./containers/postgraphile', { platform: Platform.LINUX_ARM64 }),
        containerPort: 5000,
        healthCheck: {
          command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          PG_GRAPHIQL: 'false',
          PG_ENHANCE_GRAPHIQL: 'false',
          PG_IGNORE_RBAC: 'false',
        },
        secrets: {
          DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writer),
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        },
      },
      minTaskCount: 0,
      maxTaskCount: 0,
    });

    const realtime = new AutoScalingFargateService(this, 'Realtime', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(realtimeImageUri.valueAsString),
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
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          DB_HOST: ecs.Secret.fromSecretsManager(db.secret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(db.secret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(db.secret, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(db.secret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret, 'password'),
        },
        command: ['bash', '-c', './prod/rel/realtime/bin/realtime eval Realtime.Release.migrate && ./prod/rel/realtime/bin/realtime start'],
      },
      minTaskCount: 1,
      maxTaskCount: 1,
    });

    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const storage = new AutoScalingFargateService(this, 'Storage', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(storageImageUri.valueAsString),
        containerPort: 5000,
        environment: {
          POSTGREST_URL: `${rest.endpoint}`,
          PGOPTIONS: '-c search_path=storage,public',
          FILE_SIZE_LIMIT: '52428800',
          TENANT_ID: 'stub',
          IS_MULTITENANT: 'false',
          STORAGE_BACKEND: 's3',
          REGION: bucket.env.region,
          GLOBAL_S3_BUCKET: bucket.bucketName,
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          DATABASE_URL: ecs.Secret.fromSsmParameter(db.url.writer),
        },
        healthCheck: {
          command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:5000/status || exit 1'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
      },
      //cpuArchitecture: 'x86_64', // storage-api does not work on ARM64
    });
    bucket.grantReadWrite(storage.service.taskDefinition.taskRole);

    const meta = new AutoScalingFargateService(this, 'Meta', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(postgresMetaImageUri.valueAsString),
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
    });

    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_AUTH_URL', `${auth.endpoint}/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_REST_URL', `${rest.endpoint}/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_GRAPHQL_URL', `${gql.endpoint}/graphql`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_REALTIME_URL', `${realtime.endpoint}/socket/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_STORAGE_URL', `${storage.endpoint}/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_META_HOST', `${meta.endpoint}/`);

    kong.addBackend(auth);
    kong.addBackend(rest);
    kong.addBackend(gql);
    kong.addBackend(realtime);
    kong.addBackend(storage);
    kong.addBackend(meta);

    auth.addBackend(rest);
    storage.addBackend(rest);

    auth.addDatabaseBackend(db);
    rest.addDatabaseBackend(db);
    gql.addDatabaseBackend(db);
    realtime.addDatabaseBackend(db);
    storage.addDatabaseBackend(db);
    meta.addDatabaseBackend(db);

    const forceDeployJob = new ForceDeployJob(this, 'ForceDeployJob', { cluster });

    const newServiceCreated = new events.Rule(this, 'NewServiceCreated', {
      description: 'Supabase - New service created (for Service Connect)',
      eventPattern: {
        source: ['aws.servicediscovery'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventName: ['CreateService'],
          responseElements: {
            service: {
              namespaceId: [namespace.namespaceId],
              type: ['HTTP'],
            },
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

    forceDeployJob.addTrigger({ rule: newServiceCreated }); // for Service Connect
    forceDeployJob.addTrigger({ rule: db.secretRotationSucceeded });
    forceDeployJob.addTrigger({ rule: authParameterChangedRule, services: [auth] });

    // Supabase Studio
    const studioBranch = new cdk.CfnParameter(this, 'StudioBranch', {
      type: 'String',
      default: '0.22.08',
      description: 'https://github.com/supabase/supabase/tags',
    });

    new AmplifyHosting(this, 'Studio', {
      sourceRepo: 'https://github.com/supabase/supabase.git',
      sourceBranch: studioBranch.valueAsString,
      appRoot: 'studio',
      environmentVariables: {
        STUDIO_PG_META_URL: `${apiExternalUrl}/pg`,
        POSTGRES_PASSWORD: db.secret.secretValueFromJson('password').toString(),
        SUPABASE_URL: `${apiExternalUrl}`,
        SUPABASE_REST_URL: `${apiExternalUrl}/rest/v1/`,
        SUPABASE_ANON_KEY: anonKey.value,
        SUPABASE_SERVICE_KEY: serviceRoleKey.value,
      },
      liveUpdates: [
        { pkg: 'node', type: 'npm', version: '16' },
        { pkg: 'next-version', type: 'internal', version: '12' },
      ],
    });

    new cdk.CfnOutput(this, 'SupabaseUrl', {
      value: apiExternalUrl,
      description: 'A RESTful endpoint for querying and managing your database.',
      exportName: `${cdk.Aws.STACK_NAME}Url`,
    });
    new cdk.CfnOutput(this, 'SupabasAnonKey', {
      value: anonKey.value,
      description: 'This key is safe to use in a browser if you have enabled Row Level Security for your tables and configured policies.',
      exportName: `${cdk.Aws.STACK_NAME}AnonKey`,
    });

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
            smtp.cfnParameters.email.logicalId,
            senderName.logicalId,
            smtp.cfnParameters.region.logicalId,
            smtp.cfnParameters.enableTestDomain.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - Container Image URIs' },
          Parameters: [
            authImageUri.logicalId,
            restImageUri.logicalId,
            realtimeImageUri.logicalId,
            storageImageUri.logicalId,
            postgresMetaImageUri.logicalId,
            studioBranch.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Database' },
          Parameters: [
            db.cfnParameters.instanceClass.logicalId,
            db.cfnParameters.instanceCount.logicalId,
            db.cfnParameters.minCapacity.logicalId,
            db.cfnParameters.maxCapacity.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Network & Security' },
          Parameters: [
            namespaceName.logicalId,
            cdn.cfnParameters.webAclArn.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Kong (API Gateway)' },
          Parameters: [
            kong.cfnParameters.taskSize.logicalId,
            kong.cfnParameters.minTaskCount.logicalId,
            kong.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Auth API (GoTrue)' },
          Parameters: [
            auth.cfnParameters.taskSize.logicalId,
            auth.cfnParameters.minTaskCount.logicalId,
            auth.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - RESTful API (PostgREST)' },
          Parameters: [
            rest.cfnParameters.taskSize.logicalId,
            rest.cfnParameters.minTaskCount.logicalId,
            rest.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - GraphQL API (PostGraphile)' },
          Parameters: [
            gql.cfnParameters.taskSize.logicalId,
            gql.cfnParameters.minTaskCount.logicalId,
            gql.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Realtime API' },
          Parameters: [
            realtime.cfnParameters.taskSize.logicalId,
            realtime.cfnParameters.minTaskCount.logicalId,
            realtime.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Storage API' },
          Parameters: [
            storage.cfnParameters.taskSize.logicalId,
            storage.cfnParameters.minTaskCount.logicalId,
            storage.cfnParameters.maxTaskCount.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Postgres Meta API' },
          Parameters: [
            meta.cfnParameters.taskSize.logicalId,
            meta.cfnParameters.minTaskCount.logicalId,
            meta.cfnParameters.maxTaskCount.logicalId,
          ],
        },
      ],
      ParameterLabels: {
        [disableSignup.logicalId]: { default: 'Disable User Signups' },
        [siteUrl.logicalId]: { default: 'Site URL' },
        [redirectUrls.logicalId]: { default: 'Redirect URLs' },
        [jwtExpiryLimit.logicalId]: { default: 'JWT expiry limit' },
        [passwordMinLength.logicalId]: { default: 'Min password length' },
        [smtp.cfnParameters.email.logicalId]: { default: 'Sender Email Address' },
        [senderName.logicalId]: { default: 'Sender Name' },
        [smtp.cfnParameters.region.logicalId]: { default: 'Amazon SES Region' },
        [smtp.cfnParameters.enableTestDomain.logicalId]: { default: 'Enable Test E-mail Domain (via Amazon WorkMail)' },

        [authImageUri.logicalId]: { default: 'Auth API Image URI - GoTrue' },
        [restImageUri.logicalId]: { default: 'Rest API Image URI - PostgREST' },
        [realtimeImageUri.logicalId]: { default: 'Realtime API Image URI' },
        [storageImageUri.logicalId]: { default: 'Storage API Image URI' },
        [postgresMetaImageUri.logicalId]: { default: 'Postgres Meta API Image URI' },

        [db.cfnParameters.instanceClass.logicalId]: { default: 'DB Instance Class' },
        [db.cfnParameters.instanceCount.logicalId]: { default: 'DB Instance Count' },
        [db.cfnParameters.minCapacity.logicalId]: { default: 'Minimum ACUs' },
        [db.cfnParameters.maxCapacity.logicalId]: { default: 'Maximum ACUs' },

        [namespaceName.logicalId]: { default: 'Namespace' },
        [cdn.cfnParameters.webAclArn.logicalId]: { default: 'Web ACL ARN (AWS WAF)' },

        [kong.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [kong.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [kong.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [auth.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [auth.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [auth.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [rest.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [rest.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [rest.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [gql.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [gql.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [gql.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [realtime.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [realtime.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [realtime.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [storage.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [storage.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [storage.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [meta.cfnParameters.taskSize.logicalId]: { default: 'Fargate Task Size' },
        [meta.cfnParameters.minTaskCount.logicalId]: { default: 'Minimum Fargate Task Count' },
        [meta.cfnParameters.maxTaskCount.logicalId]: { default: 'Maximum Fargate Task Count' },

        [studioBranch.logicalId]: { default: 'Supabase Studio Branch' },
      },
    };

    for (let i = 0; i < authProviders.length; i++) {
      const provider = authProviders[i];
      cfnInterface.ParameterGroups.push({
        Label: { default: `External Auth Provider ${i+1}` },
        Parameters: [
          provider.name.logicalId,
          provider.clientId.logicalId,
          provider.secret.logicalId,
        ],
      });
      cfnInterface.ParameterLabels[provider.name.logicalId] = { default: 'Provider Name' };
      cfnInterface.ParameterLabels[provider.clientId.logicalId] = { default: 'Client ID' };
      cfnInterface.ParameterLabels[provider.secret.logicalId] = { default: 'Client Secret' };
    }

    // for CloudFormation
    this.templateOptions.description = 'Self-hosted Supabase';
    this.templateOptions.metadata = { 'AWS::CloudFormation::Interface': cfnInterface };

  }
}
