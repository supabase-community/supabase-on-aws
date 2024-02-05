import * as cdk from 'aws-cdk-lib';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { SesSmtp } from './amazon-ses-smtp';
import { PrefixList } from './aws-prefix-list';
import { ForceDeployJob } from './ecs-force-deploy-job';
import { AutoScalingFargateService } from './ecs-patterns';
import { JwtSecret } from './json-web-token';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseStudio } from './supabase-studio';

export class FargateStack extends cdk.Stack {
  /** ECS Fargate task size mappings */
  readonly taskSizeMapping: cdk.CfnMapping;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    this.taskSizeMapping = new cdk.CfnMapping(this, 'TaskSize', {
      mapping: {
        'none': { cpu: 256, memory: 512 }, // Disable ECS Service
        'micro': { cpu: 256, memory: 512 },
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

  /** Supabase Stack */
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

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

    const senderEmail = new cdk.CfnParameter(this, 'Email', {
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

    const authImageUri = new cdk.CfnParameter(this, 'AuthImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/gotrue:v2.139.1',
      description: 'https://gallery.ecr.aws/supabase/gotrue',
    });
    const restImageUri = new cdk.CfnParameter(this, 'RestImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/postgrest:v12.0.2',
      description: 'https://gallery.ecr.aws/supabase/postgrest',
    });
    const realtimeImageUri = new cdk.CfnParameter(this, 'RealtimeImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/realtime:v2.25.61',
      description: 'https://gallery.ecr.aws/supabase/realtime',
    });
    const storageImageUri = new cdk.CfnParameter(this, 'StorageImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/storage-api:v0.46.5',
      description: 'https://gallery.ecr.aws/supabase/storage-api',
    });
    const imgproxyImageUri = new cdk.CfnParameter(this, 'ImgproxyImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/imgproxy:v1.2.0',
      description: 'https://gallery.ecr.aws/supabase/imgproxy',
    });
    const postgresMetaImageUri = new cdk.CfnParameter(this, 'PostgresMetaImageUri', {
      type: 'String',
      default: 'public.ecr.aws/supabase/postgres-meta:v0.75.0',
      description: 'https://gallery.ecr.aws/supabase/postgres-meta',
    });

    /** The flag for High Availability */
    const enableHighAvailability = new cdk.CfnParameter(this, 'EnableHighAvailability', {
      description: 'Enable auto-scaling and clustering (Multi-AZ).',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    /** CFn condition for High Availability */
    const highAvailability = new cdk.CfnCondition(this, 'HighAvailability', { expression: cdk.Fn.conditionEquals(enableHighAvailability, 'true') });

    /** Web ACL for CloudFront */
    const webAclArn = new cdk.CfnParameter(this, 'WebAclArn', {
      description: 'Web ACL for CloudFront.',
      type: 'String',
      default: '',
      allowedPattern: '^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/[\\w-]+/[\\w]{8}-[\\w]{4}-[\\w]{4}-[\\w]{4}-[\\w]{12}$|',
    });

    /** The minimum number of aurora capacity units */
    const minACU = new cdk.CfnParameter(this, 'MinACU', {
      description: 'The minimum number of Aurora capacity units (ACU) for a DB instance in an Aurora Serverless v2 cluster.',
      type: 'Number',
      default: 0.5,
      minValue: 0.5,
      maxValue: 128,
    });

    /** The maximum number of aurora capacity units */
    const maxACU = new cdk.CfnParameter(this, 'MaxACU', {
      description: 'The maximum number of Aurora capacity units (ACU) for a DB instance in an Aurora Serverless v2 cluster.',
      type: 'Number',
      default: 32,
      minValue: 0.5,
      maxValue: 128,
    });

    /** The region name for Amazon SES */
    const sesRegion = new cdk.CfnParameter(this, 'SesRegion', {
      description: 'Amazon SES used for SMTP server. If you want to use Amazon WorkMail, need to set us-east-1, us-west-2 or eu-west-1.',
      type: 'String',
      default: 'us-west-2',
      allowedValues: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'sa-east-1'],
    });

    /** The flag for Amazon WorkMail */
    const enableWorkMail = new cdk.CfnParameter(this, 'EnableWorkMail', {
      description: 'Enable test e-mail domain "xxx.awsapps.com" with Amazon WorkMail.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    /** CFn condition for Amazon WorkMail */
    const workMailEnabled = new cdk.CfnCondition(this, 'WorkMailEnabled', { expression: cdk.Fn.conditionEquals(enableWorkMail, 'true') });

    /** CFn rule for Amazon WorkMail region */
    new cdk.CfnRule(this, 'CheckWorkMailRegion', {
      ruleCondition: workMailEnabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionContains(['us-east-1', 'us-west-2', 'eu-west-1'], sesRegion.valueAsString),
        assertDescription: 'Amazon WorkMail is supported only in us-east-1, us-west-2 or eu-west-1. Please change Amazon SES Region.',
      }],
    });

    /** VPC for Containers and Database */
    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    /** Namespace name for CloudMap and ECS Service Connect */
    const namespaceName = 'supabase.internal';

    /** ECS Cluster for Supabase components */
    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      defaultCloudMapNamespace: {
        name: namespaceName,
        useForServiceConnect: true,
      },
      vpc,
    });

    /** PostgreSQL Database with Secrets */
    const db = new SupabaseDatabase(this, 'Database', {
      vpc,
      highAvailability,
    });

    /** SMTP Credentials */
    const smtp = new SesSmtp(this, 'Smtp', {
      region: sesRegion.valueAsString,
      email: senderEmail.valueAsString,
      workMailEnabled: workMailEnabled,
    });

    // Overwrite ACU
    (db.cluster.node.defaultChild as rds.CfnDBCluster).serverlessV2ScalingConfiguration = {
      minCapacity: minACU.valueAsNumber,
      maxCapacity: maxACU.valueAsNumber,
    };

    /** Secret of supabase_admin user */
    const supabaseAdminSecret = db.cluster.secret!;
    /** Secret of supabase_auth_admin user */
    const supabaseAuthAdminSecret = db.genUserPassword('supabase_auth_admin');
    /** Secret of supabase_storage_admin user */
    const supabaseStorageAdminSecret = db.genUserPassword('supabase_storage_admin');
    /** Secret of authenticator user */
    const authenticatorSecret = db.genUserPassword('authenticator');
    /** Secret of dashboard user  */
    const dashboardUserSecret = db.genUserPassword('dashboard_user');
    /** Secret of postgres user */
    const postgresSecret = db.genUserPassword('postgres');

    /**
     * JWT Secret
     *
     * Used to decode your JWTs. You can also use this to mint your own JWTs.
     */
    const jwtSecret = new JwtSecret(this, 'JwtSecret');

    /**
     * Anonymous Key
     *
     * This key is safe to use in a browser if you have enabled Row Level Security for your tables and configured policies.
     */
    const anonKey = jwtSecret.genApiKey('AnonKey', { roleName: 'anon', issuer: 'supabase', expiresIn: '10y' });

    /**
     * Service Role Key
     *
     * This key has the ability to bypass Row Level Security. Never share it publicly.
     */
    const serviceRoleKey = jwtSecret.genApiKey('ServiceRoleKey', { roleName: 'service_role', issuer: 'supabase', expiresIn: '10y' });

    /** The load balancer for Kong Gateway */
    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });

    /** CloudFront Prefix List */
    const cfPrefixList = new PrefixList(this, 'CloudFrontPrefixList', { prefixListName: 'com.amazonaws.global.cloudfront.origin-facing' });

    // Allow only CloudFront to connect the load balancer.
    loadBalancer.connections.allowFrom(Peer.prefixList(cfPrefixList.prefixListId), Port.tcp(80), 'CloudFront');

    /** CloudFront */
    const cdn = new SupabaseCdn(this, 'Cdn', {
      origin: loadBalancer,
      webAclArn,
    });

    /**
     * Supabase API URL
     *
     * e.g. https://xxx.cloudfront.net
     */
    const apiExternalUrl = `https://${cdn.distribution.domainName}`;

    /** API Gateway for Supabase */
    const kong = new AutoScalingFargateService(this, 'Kong', {
      cluster,
      taskImageOptions: {
        // image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/kong:latest'),
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/k1e4k0b3/kong:latest'), // FIX: new kong-template.yml version
        //image: ecs.ContainerImage.fromAsset('./containers/kong', { platform: Platform.LINUX_ARM64 }),
        containerPort: 8000,
        healthCheck: {
          command: ['CMD', 'kong', 'health'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl,basic-auth,opentelemetry',
          KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: '160k',
          KONG_NGINX_PROXY_PROXY_BUFFERS: '64 160k',
          // for HealthCheck
          KONG_STATUS_LISTEN: '0.0.0.0:8100',
          // for OpenTelemetry
          //KONG_OPENTELEMETRY_ENABLED: 'true',
          //KONG_OPENTELEMETRY_TRACING: 'all',
          //KONG_OPENTELEMETRY_TRACING_SAMPLING_RATE: '1.0',
        },
        secrets: {
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
        },
      },
      highAvailability,
    });

    /** TargetGroup for kong-gateway */
    const kongTargetGroup = kong.addTargetGroup({
      healthCheck: {
        port: '8100',
        path: '/status',
        timeout: cdk.Duration.seconds(2),
        interval: cdk.Duration.seconds(5),
      },
    });

    /** Listner for kong-gateway */
    const listener = loadBalancer.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [kongTargetGroup],
      open: false,
    });

    // Allow the load balancer to connect kong-gateway.
    kong.connections.allowFrom(loadBalancer, Port.tcp(8100), 'ALB healthcheck');

    /** GoTrue - Authentication and User Management by Supabase */
    const auth = new AutoScalingFargateService(this, 'Auth', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(authImageUri.valueAsString),
        containerPort: 9999,
        healthCheck: {
          command: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:9999/health'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          API_EXTERNAL_URL: apiExternalUrl,

          GOTRUE_DB_DRIVER: 'postgres',

          GOTRUE_SITE_URL: siteUrl.valueAsString,
          GOTRUE_URI_ALLOW_LIST: redirectUrls.valueAsString,
          GOTRUE_DISABLE_SIGNUP: disableSignup.valueAsString,

          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          GOTRUE_JWT_EXP: jwtExpiryLimit.valueAsString,

          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          GOTRUE_MAILER_AUTOCONFIRM: 'false',
          //GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: 'true',
          //GOTRUE_SMTP_MAX_FREQUENCY: '1s',
          GOTRUE_SMTP_ADMIN_EMAIL: smtp.email,
          GOTRUE_SMTP_HOST: smtp.host,
          GOTRUE_SMTP_PORT: smtp.port.toString(),
          GOTRUE_SMTP_SENDER_NAME: senderName.valueAsString,
          GOTRUE_MAILER_URLPATHS_INVITE: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',

          GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', // Amazon SNS not supported
          GOTRUE_SMS_AUTOCONFIRM: 'true',

          GOTRUE_RATE_LIMIT_EMAIL_SENT: '3600', // SES Limit: 1msg/s
          GOTRUE_PASSWORD_MIN_LENGTH: passwordMinLength.valueAsString,

          //GOTRUE_TRACING_ENABLED: 'true',
          //OTEL_SERVICE_NAME: 'gotrue',
          //OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
          //OTEL_EXPORTER_OTLP_ENDPOINT: `http://${jaeger.dnsName}:4317`,
        },
        secrets: {
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSecretsManager(supabaseAuthAdminSecret, 'uri'),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(smtp.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(smtp.secret, 'password'),
        },
      },
      highAvailability,
    });
    const authProviders = auth.addExternalAuthProviders(`${apiExternalUrl}/auth/v1/callback`, 3);

    /** RESTful API for any PostgreSQL Database */
    const rest = new AutoScalingFargateService(this, 'Rest', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(restImageUri.valueAsString),
        containerPort: 3000,
        environment: {
          PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_USE_LEGACY_GUCS: 'false',
          PGRST_APP_SETTINGS_JWT_EXP: jwtExpiryLimit.valueAsString,
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSecretsManager(authenticatorSecret, 'uri'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          PGRST_APP_SETTINGS_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        },
      },
      highAvailability,
    });

    /** GraphQL API for any PostgreSQL Database */
    //const gql = new AutoScalingFargateService(this, 'GraphQL', {
    //  cluster,
    //  taskImageOptions: {
    //    image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/postgraphile:latest'),
    //    //image: ecs.ContainerImage.fromAsset('./containers/postgraphile', { platform: Platform.LINUX_ARM64 }),
    //    containerPort: 5000,
    //    healthCheck: {
    //      command: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:5000/health'],
    //      interval: cdk.Duration.seconds(5),
    //      timeout: cdk.Duration.seconds(5),
    //      retries: 3,
    //    },
    //    environment: {
    //      PG_GRAPHIQL: 'false',
    //      PG_ENHANCE_GRAPHIQL: 'false',
    //      PG_IGNORE_RBAC: 'false',
    //    },
    //    secrets: {
    //      DATABASE_URL: ecs.Secret.fromSecretsManager(authenticatorSecret, 'uri'),
    //      JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
    //    },
    //  },
    //  highAvailability,
    //});

    /**  Secret used by the server to sign cookies. Recommended: 64 characters. */
    const cookieSigningSecret = new Secret(this, 'CookieSigningSecret', {
      secretName: `${cdk.Aws.STACK_NAME}-Realtime-CookieSigning-Secret`,
      description: 'Supabase - Cookie Signing Secret for Realtime',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    /** Websocket API */
    const realtime = new AutoScalingFargateService(this, 'Realtime', {
      serviceName: 'realtime-dev', // The sub-domain is used as tenat_id. (<tenat_id>.supabase.internal)
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(realtimeImageUri.valueAsString),
        containerPort: 4000,
        environment: {
          PORT: '4000',
          DB_HOST: db.cluster.clusterEndpoint.hostname,
          DB_PORT: db.cluster.clusterEndpoint.port.toString(),
          DB_AFTER_CONNECT_QUERY: 'SET search_path TO realtime',
          DB_ENC_KEY: 'supabaserealtime',
          FLY_ALLOC_ID: 'fly123',
          FLY_APP_NAME: 'realtime',
          ERL_AFLAGS: '-proto_dist inet_tcp', // IPv4
          ENABLE_TAILSCALE: 'false',
          DNS_NODES: `realtime-dev.${namespaceName}`,
        },
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'password'),
          DB_NAME: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'dbname'),
          API_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(cookieSigningSecret),
        },
        entryPoint: ['/usr/bin/tini', '-s', '-g', '--'], // ignore /app/limits.sh
        command: ['sh', '-c', '/app/bin/migrate && /app/bin/realtime eval "Realtime.Release.seeds(Realtime.Repo)" && /app/bin/server'],
      },
      highAvailability,
    });

    // Wait until the database migration is complete.
    realtime.service.node.addDependency(db.migration.node.defaultChild!);

    // Allow each container to connect others in cluster
    realtime.connections.allowInternally(Port.allTraffic());

    /** Supabase Storage Backend */
    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    /** API & Queue of Cache Manager */
    const cacheManager = cdn.addCacheManager();

    /** Image Transformer for Storage */
    const imgproxy = new AutoScalingFargateService(this, 'Imgproxy', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(imgproxyImageUri.valueAsString),
        containerPort: 5001,
        healthCheck: {
          command: ['CMD', 'imgproxy', 'health'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          IMGPROXY_BIND: ':5001',
          IMGPROXY_LOCAL_FILESYSTEM_ROOT: '/',
          IMGPROXY_USE_ETAG: 'true',
          IMGPROXY_ENABLE_WEBP_DETECTION: 'true',
        },
      },
      highAvailability,
    });

    /** S3 compatible object storage API that stores metadata in Postgres */
    const storage = new AutoScalingFargateService(this, 'Storage', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(storageImageUri.valueAsString),
        containerPort: 5000,
        healthCheck: {
          command: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:5000/status'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          POSTGREST_URL: `${rest.endpoint}`,
          PGOPTIONS: '-c search_path=storage,public',
          FILE_SIZE_LIMIT: '52428800',
          STORAGE_BACKEND: 's3',
          TENANT_ID: 'stub',
          IS_MULTITENANT: 'false',
          // TODO: https://github.com/supabase/storage-api/issues/55
          REGION: cdk.Aws.REGION,
          GLOBAL_S3_BUCKET: bucket.bucketName,
          ENABLE_IMAGE_TRANSFORMATION: 'true',
          IMGPROXY_URL: imgproxy.endpoint,
          // Smart CDN Caching
          WEBHOOK_URL: cacheManager.url,
          ENABLE_QUEUE_EVENTS: 'false',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          DATABASE_URL: ecs.Secret.fromSecretsManager(supabaseStorageAdminSecret, 'uri'),
          WEBHOOK_API_KEY: ecs.Secret.fromSecretsManager(cacheManager.apiKey),
        },
      },
      highAvailability,
    });

    // Allow storage-api to read and write to the bucket
    bucket.grantReadWrite(storage.service.taskDefinition.taskRole);

    /** A RESTful API for managing your Postgres. Fetch tables, add roles, and run queries */
    const meta = new AutoScalingFargateService(this, 'Meta', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(postgresMetaImageUri.valueAsString),
        containerPort: 8080,
        environment: {
          PG_META_PORT: '8080',
          PG_META_DB_HOST: db.cluster.clusterEndpoint.hostname,
          PG_META_DB_PORT: db.cluster.clusterEndpoint.port.toString(),
        },
        secrets: {
          PG_META_DB_NAME: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'dbname'),
          PG_META_DB_USER: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'username'),
          PG_META_DB_PASSWORD: ecs.Secret.fromSecretsManager(supabaseAdminSecret, 'password'),
        },
      },
      highAvailability,
    });

    // Wait until the database migration is complete.
    meta.service.node.addDependency(db.migration.node.defaultChild!);

    // Add environment variables to kong-gateway
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_AUTH_URL', `${auth.endpoint}/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_REST_URL', `${rest.endpoint}/`);
    //kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_GRAPHQL_URL', `${gql.endpoint}/graphql`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_REALTIME_SOCKET_URL', `${realtime.endpoint}/socket/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_REALTIME_API_URL', `${realtime.endpoint}/api/`);    
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_STORAGE_URL', `${storage.endpoint}/`);
    kong.service.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_META_HOST', `${meta.endpoint}/`);

    // Allow kong-gateway to connect other services
    kong.connections.allowToDefaultPort(auth);
    kong.connections.allowToDefaultPort(rest);
    //kong.connections.allowToDefaultPort(gql);
    kong.connections.allowToDefaultPort(realtime);
    kong.connections.allowToDefaultPort(storage);
    kong.connections.allowToDefaultPort(meta);

    auth.connections.allowToDefaultPort(rest);
    storage.connections.allowToDefaultPort(rest);
    storage.connections.allowToDefaultPort(imgproxy);

    // Allow some services to connect the database
    auth.connections.allowToDefaultPort(db.cluster);
    rest.connections.allowToDefaultPort(db.cluster);
    //gql.connections.allowToDefaultPort(db.cluster);
    realtime.connections.allowToDefaultPort(db.cluster);
    storage.connections.allowToDefaultPort(db.cluster);
    meta.connections.allowToDefaultPort(db.cluster);

    const forceDeployJob = new ForceDeployJob(this, 'ForceDeployJob', { cluster });
    // for DB secret rotation
    //forceDeployJob.addTrigger({
    //  rule: db.secretRotationSucceeded,
    //});
    // for Auth provider settings changed
    forceDeployJob.addTrigger({
      input: { services: [auth.service.serviceArn] },
      rule: new events.Rule(this, 'AuthParameterChanged', {
        description: 'Supabase - Auth parameter changed',
        eventPattern: {
          source: ['aws.ssm'],
          detailType: ['Parameter Store Change'],
          detail: {
            name: [{ prefix: `/${cdk.Aws.STACK_NAME}/${auth.node.id}/` }],
            operation: ['Update'],
          },
        },
      }),
    });

    /** Supabase Studio Version */
    const studioBranch = new cdk.CfnParameter(this, 'StudioBranch', {
      type: 'String',
      default: 'v0.23.09',
      description: 'Branch or tag - https://github.com/supabase/supabase/tags',
    });

    /** Supabase Studio */
    const studio = new SupabaseStudio(this, 'Studio', {
      sourceBranch: studioBranch.valueAsString,
      supabaseUrl: apiExternalUrl,
      dbSecret: dashboardUserSecret,
      anonKey: anonKey.ssmParameter,
      serviceRoleKey: serviceRoleKey.ssmParameter,
    });

    new cdk.CfnOutput(this, 'StudioUrl', {
      value: studio.prodBranchUrl,
      description: 'The dashboard for Supabase projects.',
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

    /**
     * CloudFormation Interface
     * @resource AWS::CloudFormation::Interface
     */
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
          Label: { default: 'Supabase - SMTP Settings' },
          Parameters: [
            senderEmail.logicalId,
            senderName.logicalId,
            sesRegion.logicalId,
            enableWorkMail.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - Versions (Container Images)' },
          Parameters: [
            authImageUri.logicalId,
            restImageUri.logicalId,
            realtimeImageUri.logicalId,
            storageImageUri.logicalId,
            imgproxyImageUri.logicalId,
            postgresMetaImageUri.logicalId,
            studioBranch.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings' },
          Parameters: [
            enableHighAvailability.logicalId,
            webAclArn.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Database' },
          Parameters: [
            minACU.logicalId,
            maxACU.logicalId,
          ],
        },
        {
          Label: { default: 'Infrastructure Settings - Containers' },
          Parameters: [
            kong.taskSize.logicalId,
            auth.taskSize.logicalId,
            rest.taskSize.logicalId,
            //gql.taskSize.logicalId,
            realtime.taskSize.logicalId,
            storage.taskSize.logicalId,
            imgproxy.taskSize.logicalId,
            meta.taskSize.logicalId,
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
        [enableWorkMail.logicalId]: { default: 'Enable Test E-mail Domain (via Amazon WorkMail)' },

        [authImageUri.logicalId]: { default: 'Image URI - GoTrue' },
        [restImageUri.logicalId]: { default: 'Image URI - PostgREST' },
        [realtimeImageUri.logicalId]: { default: 'Image URI - Realtime' },
        [storageImageUri.logicalId]: { default: 'Image URI - Storage' },
        [imgproxyImageUri.logicalId]: { default: 'Image URI - imgproxy' },
        [postgresMetaImageUri.logicalId]: { default: 'Image URI - postgres-meta' },

        [enableHighAvailability.logicalId]: { default: 'High Availability (HA)' },
        [webAclArn.logicalId]: { default: 'Web ACL ARN (AWS WAF)' },

        [minACU.logicalId]: { default: 'Minimum ACUs' },
        [maxACU.logicalId]: { default: 'Maximum ACUs' },

        [kong.taskSize.logicalId]: { default: 'Task Size - Kong' },
        [auth.taskSize.logicalId]: { default: 'Task Size - GoTrue' },
        [rest.taskSize.logicalId]: { default: 'Task Size - PostgREST' },
        //[gql.taskSize.logicalId]: { default: 'Task Size - PostGraphile' },
        [realtime.taskSize.logicalId]: { default: 'Task Size - Realtime' },
        [storage.taskSize.logicalId]: { default: 'Task Size - Storage' },
        [imgproxy.taskSize.logicalId]: { default: 'Task Size - imgproxy' },
        [meta.taskSize.logicalId]: { default: 'Task Size - postgres-meta' },

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
