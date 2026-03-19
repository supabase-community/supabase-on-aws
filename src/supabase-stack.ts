import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { SesSmtp } from './amazon-ses-smtp';
import { PrefixList } from './aws-prefix-list';
import { ForceDeployJob } from './ecs-force-deploy-job';
import { AutoScalingFargateService } from './ecs-patterns';
import { JwtSecret } from './json-web-token';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDbInit } from './supabase-db-init';

export interface SupabaseStackProps extends cdk.StackProps {
  vpc?: ec2.IVpc;
  databaseEndpoint?: { hostname: string; port: number };
  databaseAdminSecret?: secretsmanager.ISecret;
  databaseSecurityGroup?: ec2.ISecurityGroup;
}

export class FargateStack extends cdk.Stack {
  /** ECS Fargate task size mappings */
  readonly taskSizeMapping: cdk.CfnMapping;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    this.taskSizeMapping = new cdk.CfnMapping(this, 'TaskSize', {
      mapping: {
        'none': { cpu: 256, memory: 512 },
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

  constructor(scope: Construct, id: string, props: SupabaseStackProps = {}) {
    super(scope, id, props);

    // --- External resources (VPC & DB) via context or props ---
    const vpc = props.vpc ?? ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: this.node.tryGetContext('vpcId'),
    });

    const dbHostname = props.databaseEndpoint?.hostname ?? this.node.tryGetContext('dbHostname') ?? 'localhost';
    const dbPort = props.databaseEndpoint?.port ?? parseInt(this.node.tryGetContext('dbPort') ?? '5432');
    const databaseEndpoint = { hostname: dbHostname, port: dbPort };

    const databaseAdminSecret = props.databaseAdminSecret ?? secretsmanager.Secret.fromSecretNameV2(
      this, 'DatabaseAdminSecret', this.node.tryGetContext('dbAdminSecretName') ?? `${cdk.Aws.STACK_NAME}-Database-supabase_admin`,
    );

    const databaseSecurityGroup = props.databaseSecurityGroup ?? ec2.SecurityGroup.fromSecurityGroupId(
      this, 'DatabaseSecurityGroup', this.node.tryGetContext('dbSecurityGroupId') ?? 'sg-placeholder',
    );

    // --- CfnParameters ---
    const disableSignup = new cdk.CfnParameter(this, 'DisableSignup', {
      description: 'When signup is disabled the only way to create new users is through invites.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const siteUrl = new cdk.CfnParameter(this, 'SiteUrl', {
      description: 'The base URL your site is located at.',
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
      description: 'Minimum password length for signups.',
      type: 'Number',
      default: '8',
      minValue: 8,
      maxValue: 128,
    });

    const senderEmail = new cdk.CfnParameter(this, 'Email', {
      description: 'Email address for sending transactional emails.',
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
      default: 'supabase/gotrue:v2.186.0',
      description: 'GoTrue auth service image',
    });
    const restImageUri = new cdk.CfnParameter(this, 'RestImageUri', {
      type: 'String',
      default: 'postgrest/postgrest:v14.6',
      description: 'PostgREST image',
    });
    const realtimeImageUri = new cdk.CfnParameter(this, 'RealtimeImageUri', {
      type: 'String',
      default: 'supabase/realtime:v2.76.5',
      description: 'Realtime service image',
    });
    const storageImageUri = new cdk.CfnParameter(this, 'StorageImageUri', {
      type: 'String',
      default: 'supabase/storage-api:v1.44.2',
      description: 'Storage API image',
    });
    const imgproxyImageUri = new cdk.CfnParameter(this, 'ImgproxyImageUri', {
      type: 'String',
      default: 'darthsim/imgproxy:v3.30.1',
      description: 'Imgproxy image',
    });
    const postgresMetaImageUri = new cdk.CfnParameter(this, 'PostgresMetaImageUri', {
      type: 'String',
      default: 'supabase/postgres-meta:v0.95.2',
      description: 'Postgres Meta image',
    });
    const studioImageUri = new cdk.CfnParameter(this, 'StudioImageUri', {
      type: 'String',
      default: 'supabase/studio:2026.03.16-sha-5528817',
      description: 'Studio image',
    });
    const functionsImageUri = new cdk.CfnParameter(this, 'FunctionsImageUri', {
      type: 'String',
      default: 'supabase/edge-runtime:v1.71.2',
      description: 'Edge Functions runtime image',
    });
    const supavisorImageUri = new cdk.CfnParameter(this, 'SupavisorImageUri', {
      type: 'String',
      default: 'supabase/supavisor:2.7.4',
      description: 'Supavisor connection pooler image',
    });

    const enableHighAvailability = new cdk.CfnParameter(this, 'EnableHighAvailability', {
      description: 'Enable auto-scaling and clustering (Multi-AZ).',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    const highAvailability = new cdk.CfnCondition(this, 'HighAvailability', { expression: cdk.Fn.conditionEquals(enableHighAvailability, 'true') });

    const webAclArn = new cdk.CfnParameter(this, 'WebAclArn', {
      description: 'Web ACL for CloudFront.',
      type: 'String',
      default: '',
      allowedPattern: '^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/[\\w-]+/[\\w]{8}-[\\w]{4}-[\\w]{4}-[\\w]{4}-[\\w]{12}$|',
    });

    const sesRegion = new cdk.CfnParameter(this, 'SesRegion', {
      description: 'Amazon SES region for SMTP.',
      type: 'String',
      default: 'us-west-2',
      allowedValues: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'sa-east-1'],
    });

    const enableWorkMail = new cdk.CfnParameter(this, 'EnableWorkMail', {
      description: 'Enable test e-mail domain "xxx.awsapps.com" with Amazon WorkMail.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });
    const workMailEnabled = new cdk.CfnCondition(this, 'WorkMailEnabled', { expression: cdk.Fn.conditionEquals(enableWorkMail, 'true') });

    new cdk.CfnRule(this, 'CheckWorkMailRegion', {
      ruleCondition: workMailEnabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionContains(['us-east-1', 'us-west-2', 'eu-west-1'], sesRegion.valueAsString),
        assertDescription: 'Amazon WorkMail is supported only in us-east-1, us-west-2 or eu-west-1.',
      }],
    });

    // --- Namespace & Cluster ---
    const namespaceName = 'supabase.internal';

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      defaultCloudMapNamespace: {
        name: namespaceName,
        useForServiceConnect: true,
      },
      vpc,
    });

    // --- JWT ---
    const jwtSecret = new JwtSecret(this, 'JwtSecret');

    const anonKey = jwtSecret.genApiKey('AnonKey', { roleName: 'anon', issuer: 'supabase', expiresIn: '10y' });
    const serviceRoleKey = jwtSecret.genApiKey('ServiceRoleKey', { roleName: 'service_role', issuer: 'supabase', expiresIn: '10y' });

    // --- DB Init ---
    const dbInit = new SupabaseDbInit(this, 'DbInit', {
      vpc,
      databaseAdminSecret,
      databaseSecurityGroup,
      databaseEndpoint,
      jwtSecret,
      jwtExp: jwtExpiryLimit.valueAsNumber,
    });

    // --- SMTP ---
    const smtp = new SesSmtp(this, 'Smtp', {
      region: sesRegion.valueAsString,
      email: senderEmail.valueAsString,
      workMailEnabled,
    });

    // --- Dashboard credentials ---
    const dashboardSecret = new secretsmanager.Secret(this, 'DashboardSecret', {
      secretName: `${cdk.Aws.STACK_NAME}-Dashboard`,
      description: 'Supabase - Dashboard basic auth credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'supabase' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    // --- Crypto key for postgres-meta ---
    const metaCryptoKey = new secretsmanager.Secret(this, 'MetaCryptoKey', {
      secretName: `${cdk.Aws.STACK_NAME}-MetaCryptoKey`,
      description: 'Supabase - Postgres Meta crypto key',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    // --- Load Balancer ---
    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });

    const cfPrefixList = new PrefixList(this, 'CloudFrontPrefixList', { prefixListName: 'com.amazonaws.global.cloudfront.origin-facing' });
    loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cfPrefixList.prefixListId), ec2.Port.tcp(80), 'CloudFront');

    // --- CloudFront ---
    const cdn = new SupabaseCdn(this, 'Cdn', {
      origin: loadBalancer,
      webAclArn,
    });

    const apiExternalUrl = `https://${cdn.distribution.domainName}`;

    // --- Kong ---
    const kong = new AutoScalingFargateService(this, 'Kong', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('./containers/kong', { platform: Platform.LINUX_ARM64 }),
        containerPort: 8000,
        healthCheck: {
          command: ['CMD', 'kong', 'health'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
        },
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_DNS_NOT_FOUND_TTL: '1',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl,basic-auth,request-termination,ip-restriction,post-function',
          KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: '160k',
          KONG_NGINX_PROXY_PROXY_BUFFERS: '64 160k',
          KONG_STATUS_LISTEN: '0.0.0.0:8100',
        },
        secrets: {
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          DASHBOARD_USERNAME: ecs.Secret.fromSecretsManager(dashboardSecret, 'username'),
          DASHBOARD_PASSWORD: ecs.Secret.fromSecretsManager(dashboardSecret, 'password'),
        },
      },
      highAvailability,
    });

    const kongTargetGroup = kong.addTargetGroup({
      healthCheck: {
        port: '8100',
        path: '/status',
        timeout: cdk.Duration.seconds(2),
        interval: cdk.Duration.seconds(5),
      },
    });

    loadBalancer.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [kongTargetGroup],
      open: false,
    });

    kong.connections.allowFrom(loadBalancer, ec2.Port.tcp(8100), 'ALB healthcheck');

    // --- Auth (GoTrue) ---
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
          GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
          GOTRUE_MAILER_AUTOCONFIRM: 'false',
          GOTRUE_SMTP_ADMIN_EMAIL: smtp.email,
          GOTRUE_SMTP_HOST: smtp.host,
          GOTRUE_SMTP_PORT: smtp.port.toString(),
          GOTRUE_SMTP_SENDER_NAME: senderName.valueAsString,
          GOTRUE_MAILER_URLPATHS_INVITE: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',
          GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
          GOTRUE_SMS_AUTOCONFIRM: 'true',
          GOTRUE_RATE_LIMIT_EMAIL_SENT: '3600',
          GOTRUE_PASSWORD_MIN_LENGTH: passwordMinLength.valueAsString,
        },
        secrets: {
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSecretsManager(dbInit.supabaseAuthAdminSecret, 'uri'),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(smtp.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(smtp.secret, 'password'),
        },
      },
      highAvailability,
    });
    const authProviders = auth.addExternalAuthProviders(`${apiExternalUrl}/auth/v1/callback`, 3);

    // --- PostgREST ---
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
          PGRST_DB_MAX_ROWS: '1000',
          PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSecretsManager(dbInit.authenticatorSecret, 'uri'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          PGRST_APP_SETTINGS_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        },
      },
      highAvailability,
    });

    // --- Cookie Signing Secret for Realtime ---
    const cookieSigningSecret = new secretsmanager.Secret(this, 'CookieSigningSecret', {
      secretName: `${cdk.Aws.STACK_NAME}-Realtime-CookieSigning-Secret`,
      description: 'Supabase - Cookie Signing Secret for Realtime',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    // --- Realtime ---
    const realtime = new AutoScalingFargateService(this, 'Realtime', {
      serviceName: 'realtime-dev',
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(realtimeImageUri.valueAsString),
        containerPort: 4000,
        environment: {
          PORT: '4000',
          DB_HOST: databaseEndpoint.hostname,
          DB_PORT: databaseEndpoint.port.toString(),
          DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime',
          DB_ENC_KEY: 'supabaserealtime',
          ERL_AFLAGS: '-proto_dist inet_tcp',
          DNS_NODES: `realtime-dev.${namespaceName}`,
          RLIMIT_NOFILE: '10000',
          APP_NAME: 'realtime',
          SEED_SELF_HOST: 'true',
          RUN_JANITOR: 'true',
        },
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'password'),
          DB_NAME: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'dbname'),
          API_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          METRICS_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(cookieSigningSecret),
        },
        entryPoint: ['/usr/bin/tini', '-s', '-g', '--'],
        command: ['sh', '-c', '/app/bin/migrate && /app/bin/realtime eval "Realtime.Release.seeds(Realtime.Repo)" && /app/bin/server'],
      },
      highAvailability,
    });

    realtime.service.node.addDependency(dbInit.migration.node.defaultChild!);
    realtime.connections.allowInternally(ec2.Port.allTraffic());

    // --- Storage Bucket ---
    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const cacheManager = cdn.addCacheManager();

    // --- Imgproxy ---
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
          IMGPROXY_AUTO_WEBP: 'true',
          IMGPROXY_MAX_SRC_RESOLUTION: '16.8',
        },
      },
      highAvailability,
    });

    // --- Storage ---
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
          REGION: cdk.Aws.REGION,
          GLOBAL_S3_BUCKET: bucket.bucketName,
          ENABLE_IMAGE_TRANSFORMATION: 'true',
          IMGPROXY_URL: imgproxy.endpoint,
          WEBHOOK_URL: cacheManager.url,
          ENABLE_QUEUE_EVENTS: 'false',
          STORAGE_PUBLIC_URL: apiExternalUrl,
          REQUEST_ALLOW_X_FORWARDED_PATH: 'true',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          AUTH_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          DATABASE_URL: ecs.Secret.fromSecretsManager(dbInit.supabaseStorageAdminSecret, 'uri'),
          WEBHOOK_API_KEY: ecs.Secret.fromSecretsManager(cacheManager.apiKey),
        },
      },
      highAvailability,
    });

    bucket.grantReadWrite(storage.service.taskDefinition.taskRole);

    // --- Postgres Meta ---
    const meta = new AutoScalingFargateService(this, 'Meta', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(postgresMetaImageUri.valueAsString),
        containerPort: 8080,
        environment: {
          PG_META_PORT: '8080',
          PG_META_DB_HOST: databaseEndpoint.hostname,
          PG_META_DB_PORT: databaseEndpoint.port.toString(),
        },
        secrets: {
          PG_META_DB_NAME: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'dbname'),
          PG_META_DB_USER: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'username'),
          PG_META_DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'password'),
          CRYPTO_KEY: ecs.Secret.fromSecretsManager(metaCryptoKey),
        },
      },
      highAvailability,
    });

    meta.service.node.addDependency(dbInit.migration.node.defaultChild!);

    // --- Studio (ECS, replaces Amplify) ---
    const studio = new AutoScalingFargateService(this, 'Studio', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(studioImageUri.valueAsString),
        containerPort: 3000,
        healthCheck: {
          command: ['CMD', 'node', '-e', "fetch('http://localhost:3000/api/platform/profile').then(r => { if (r.status !== 200) throw new Error(r.status.toString()) })"],
          interval: cdk.Duration.seconds(15),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
          startPeriod: cdk.Duration.seconds(30),
        },
        environment: {
          HOSTNAME: '::',
          STUDIO_PG_META_URL: meta.endpoint,
          SUPABASE_URL: `http://kong.${namespaceName}:8000`,
          SUPABASE_PUBLIC_URL: apiExternalUrl,
          DEFAULT_ORGANIZATION_NAME: 'Default Organization',
          DEFAULT_PROJECT_NAME: 'Default Project',
          NEXT_PUBLIC_ENABLE_LOGS: 'true',
          NEXT_ANALYTICS_BACKEND_PROVIDER: 'postgres',
          POSTGRES_HOST: databaseEndpoint.hostname,
          POSTGRES_PORT: databaseEndpoint.port.toString(),
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'password'),
          POSTGRES_DB: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'dbname'),
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          AUTH_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          PG_META_CRYPTO_KEY: ecs.Secret.fromSecretsManager(metaCryptoKey),
        },
      },
      highAvailability,
    });

    // --- Edge Functions ---
    const functionsFs = new efs.FileSystem(this, 'FunctionsEfs', {
      vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const functionsAccessPoint = functionsFs.addAccessPoint('Functions', {
      path: '/functions',
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
      posixUser: { uid: '1000', gid: '1000' },
    });

    const functions = new AutoScalingFargateService(this, 'Functions', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(functionsImageUri.valueAsString),
        containerPort: 9000,
        command: ['start', '--main-service', '/home/deno/functions/main'],
        environment: {
          SUPABASE_URL: `http://kong.${namespaceName}:8000`,
          SUPABASE_PUBLIC_URL: apiExternalUrl,
          VERIFY_JWT: 'true',
        },
        secrets: {
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(anonKey.ssmParameter),
          SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSsmParameter(serviceRoleKey.ssmParameter),
          SUPABASE_DB_URL: ecs.Secret.fromSecretsManager(dbInit.postgresSecret, 'uri'),
        },
      },
      highAvailability,
      volumes: [{
        name: 'functions',
        efsVolumeConfiguration: {
          fileSystemId: functionsFs.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: {
            accessPointId: functionsAccessPoint.accessPointId,
            iam: 'ENABLED',
          },
        },
      }],
      mountPoints: [{
        containerPath: '/home/deno/functions',
        readOnly: false,
        sourceVolume: 'functions',
      }],
    });

    // Grant EFS access
    functionsFs.grant(functions.service.taskDefinition.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');
    functionsFs.connections.allowDefaultPortFrom(functions.service.connections);

    // --- Supavisor ---
    const supavisorSecretKeyBase = new secretsmanager.Secret(this, 'SupavisorSecretKeyBase', {
      secretName: `${cdk.Aws.STACK_NAME}-Supavisor-SecretKeyBase`,
      description: 'Supabase - Supavisor SECRET_KEY_BASE',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const supavisorVaultEncKey = new secretsmanager.Secret(this, 'SupavisorVaultEncKey', {
      secretName: `${cdk.Aws.STACK_NAME}-Supavisor-VaultEncKey`,
      description: 'Supabase - Supavisor VAULT_ENC_KEY',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    const supavisor = new AutoScalingFargateService(this, 'Supavisor', {
      cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(supavisorImageUri.valueAsString),
        containerPort: 4000,
        healthCheck: {
          command: ['CMD', 'curl', '-sSfL', '--head', '-o', '/dev/null', 'http://127.0.0.1:4000/api/health'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(5),
          retries: 10,
          startPeriod: cdk.Duration.seconds(30),
        },
        environment: {
          PORT: '4000',
          POSTGRES_PORT: databaseEndpoint.port.toString(),
          POSTGRES_DB: 'postgres',
          DB_HOST: databaseEndpoint.hostname,
          CLUSTER_POSTGRES: 'true',
          REGION: 'local',
          ERL_AFLAGS: '-proto_dist inet_tcp',
          POOLER_TENANT_ID: 'default',
          POOLER_DEFAULT_POOL_SIZE: '15',
          POOLER_MAX_CLIENT_CONN: '200',
          POOLER_POOL_MODE: 'transaction',
          DB_POOL_SIZE: '5',
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(databaseAdminSecret, 'password'),
          DATABASE_URL: ecs.Secret.fromSecretsManager(dbInit.supabaseAuthAdminSecret, 'uri'),
          SECRET_KEY_BASE: ecs.Secret.fromSecretsManager(supavisorSecretKeyBase),
          VAULT_ENC_KEY: ecs.Secret.fromSecretsManager(supavisorVaultEncKey),
          API_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          METRICS_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        },
        command: ['/bin/sh', '-c', '/app/bin/migrate && /app/bin/server'],
      },
      highAvailability,
    });

    supavisor.service.node.addDependency(dbInit.migration.node.defaultChild!);

    // --- Kong environment: service URLs ---
    const kongContainer = kong.service.taskDefinition.defaultContainer!;
    kongContainer.addEnvironment('SUPABASE_AUTH_URL', `${auth.endpoint}/`);
    kongContainer.addEnvironment('SUPABASE_REST_URL', `${rest.endpoint}/`);
    kongContainer.addEnvironment('SUPABASE_REALTIME_URL', `${realtime.endpoint}/socket/`);
    kongContainer.addEnvironment('SUPABASE_STORAGE_URL', `${storage.endpoint}/`);
    kongContainer.addEnvironment('SUPABASE_META_HOST', `${meta.endpoint}/`);
    kongContainer.addEnvironment('SUPABASE_FUNCTIONS_URL', `${functions.endpoint}/`);
    kongContainer.addEnvironment('SUPABASE_STUDIO_URL', `${studio.endpoint}/`);

    // --- Networking: Kong to services ---
    kong.connections.allowToDefaultPort(auth);
    kong.connections.allowToDefaultPort(rest);
    kong.connections.allowToDefaultPort(realtime);
    kong.connections.allowToDefaultPort(storage);
    kong.connections.allowToDefaultPort(meta);
    kong.connections.allowToDefaultPort(functions);
    kong.connections.allowToDefaultPort(studio);

    // Inter-service connections
    auth.connections.allowToDefaultPort(rest);
    storage.connections.allowToDefaultPort(rest);
    storage.connections.allowToDefaultPort(imgproxy);
    studio.connections.allowToDefaultPort(meta);
    studio.connections.allowToDefaultPort(kong);

    // Database connections
    const dbPort_ = ec2.Port.tcp(databaseEndpoint.port);
    auth.connections.allowTo(databaseSecurityGroup, dbPort_);
    rest.connections.allowTo(databaseSecurityGroup, dbPort_);
    realtime.connections.allowTo(databaseSecurityGroup, dbPort_);
    storage.connections.allowTo(databaseSecurityGroup, dbPort_);
    meta.connections.allowTo(databaseSecurityGroup, dbPort_);
    supavisor.connections.allowTo(databaseSecurityGroup, dbPort_);

    // --- Force Deploy Job ---
    const forceDeployJob = new ForceDeployJob(this, 'ForceDeployJob', { cluster });
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

    // --- Outputs ---
    new cdk.CfnOutput(this, 'StudioUrl', {
      value: apiExternalUrl,
      description: 'Supabase Studio (via CloudFront / Kong).',
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

    // --- CloudFormation Interface ---
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
            studioImageUri.logicalId,
            functionsImageUri.logicalId,
            supavisorImageUri.logicalId,
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
          Label: { default: 'Infrastructure Settings - Containers' },
          Parameters: [
            kong.taskSize.logicalId,
            auth.taskSize.logicalId,
            rest.taskSize.logicalId,
            realtime.taskSize.logicalId,
            storage.taskSize.logicalId,
            imgproxy.taskSize.logicalId,
            meta.taskSize.logicalId,
            studio.taskSize.logicalId,
            functions.taskSize.logicalId,
            supavisor.taskSize.logicalId,
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
        [studioImageUri.logicalId]: { default: 'Image URI - Studio' },
        [functionsImageUri.logicalId]: { default: 'Image URI - Edge Functions' },
        [supavisorImageUri.logicalId]: { default: 'Image URI - Supavisor' },

        [enableHighAvailability.logicalId]: { default: 'High Availability (HA)' },
        [webAclArn.logicalId]: { default: 'Web ACL ARN (AWS WAF)' },

        [kong.taskSize.logicalId]: { default: 'Task Size - Kong' },
        [auth.taskSize.logicalId]: { default: 'Task Size - GoTrue' },
        [rest.taskSize.logicalId]: { default: 'Task Size - PostgREST' },
        [realtime.taskSize.logicalId]: { default: 'Task Size - Realtime' },
        [storage.taskSize.logicalId]: { default: 'Task Size - Storage' },
        [imgproxy.taskSize.logicalId]: { default: 'Task Size - imgproxy' },
        [meta.taskSize.logicalId]: { default: 'Task Size - postgres-meta' },
        [studio.taskSize.logicalId]: { default: 'Task Size - Studio' },
        [functions.taskSize.logicalId]: { default: 'Task Size - Edge Functions' },
        [supavisor.taskSize.logicalId]: { default: 'Task Size - Supavisor' },
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

    this.templateOptions.description = 'Self-hosted Supabase';
    this.templateOptions.metadata = { 'AWS::CloudFormation::Interface': cfnInterface };
  }
}
