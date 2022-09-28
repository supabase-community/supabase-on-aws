import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ManagedPrefixList } from './aws-prefix-list';
import { WorkMail } from './aws-workmail';
import { SupabaseAuth } from './supabase-auth';
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
  meshEnabled?: boolean;
  gqlEnabled?: boolean;
}

export class SupabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SupabaseStackProps = {}) {
    super(scope, id, props);

    const { meshEnabled, gqlEnabled } = props;

    // Parameters
    const disableSignupParameter = new cdk.CfnParameter(this, 'DisableSignupParameter', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const siteUrlParameter = new cdk.CfnParameter(this, 'SiteUrlParameter', {
      description: 'The base URL your site is located at. Currently used in combination with other settings to construct URLs used in emails.',
      type: 'String',
      default: 'http://localhost:3000',
    });

    const redirectUrlsParameter = new cdk.CfnParameter(this, 'RedirectUrlsParameter', {
      description: 'URLs that auth providers are permitted to redirect to post authentication',
      type: 'String',
      default: '',
    });

    const jwtExpiryLimitParameter = new cdk.CfnParameter(this, 'JwtExpiryLimitParameter', {
      description: 'How long tokens are valid for. Defaults to 3600 (1 hour), maximum 604,800 seconds (one week).',
      type: 'Number',
      default: 3600,
      minValue: 300,
      maxValue: 604800,
    });

    const passwordMinLengthParameter = new cdk.CfnParameter(this, 'PasswordMinLengthParameter', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'Number',
      default: '16',
      minValue: 8,
      maxValue: 128,
    });

    const smtpAdminEmailParameter = new cdk.CfnParameter(this, 'SmtpAdminEmailParameter', {
      description: 'The From e-mail address for all emails sent. If you want test e-mail, you can use Amazon WorkMail',
      type: 'String',
      default: 'noreply@example.com',
      allowedPattern: '^[\\x20-\\x45]?[\\w-\\+]+(\\.[\\w]+)*@[\\w-]+(\\.[\\w]+)*(\\.[a-z]{2,})$',
      constraintDescription: 'must be a valid email address',
    });

    const smtpSenderNameParameter = new cdk.CfnParameter(this, 'SmtpSenderNameParameter', {
      description: 'The From email sender name for all emails sent.',
      type: 'String',
      default: 'Supabase',
    });

    const sesRegionParameter = new cdk.CfnParameter(this, 'SesRegionParameter', {
      description: 'Use Amazon SES as SMTP server. You must choose a region.',
      type: 'String',
      default: 'us-west-2',
      allowedValues: sesSmtpSupportedRegions,
    });

    const workMailEnabledParameter = new cdk.CfnParameter(this, 'WorkMailEnabledParameter', {
      description: 'Enable Amazon WorkMail. To use "supabase-<account_id>.awsapps.com" domain with Amazon SES.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const wafRequestRateLimitParameter = new cdk.CfnParameter(this, 'WafRequestRateLimitParameter', {
      description: 'The rate limit is the maximum number of requests from a single IP address that are allowed in a five-minute period. This value is continually evaluated, and requests will be blocked once this limit is reached. The IP address is automatically unblocked after it falls below the limit.',
      type: 'Number',
      default: 30000,
      minValue: 100,
      maxValue: 20000000,
    });

    // Parameters - Supabase Version
    const authApiVersionParameter = new cdk.CfnParameter(this, 'AuthApiVersionParameter', {
      type: 'String',
      default: 'v2.15.5',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/gotrue`,
    });
    const restApiVersionParameter = new cdk.CfnParameter(this, 'RestApiVersionParameter', {
      type: 'String',
      default: 'v9.0.1.20220802',
      description: `Docker image tag - ${ecrGalleryUrl}/postgrest`,
    });
    const realtimeApiVersionParameter = new cdk.CfnParameter(this, 'RealtimeApiVersionParameter', {
      type: 'String',
      default: 'v0.24.2',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/realtime`,
    });
    const storageApiVersionParameter = new cdk.CfnParameter(this, 'StorageApiVersionParameter', {
      type: 'String',
      default: 'v0.20.0',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/storage-api`,
    });
    const postgresMetaApiVersionParameter = new cdk.CfnParameter(this, 'PostgresMetaApiVersionParameter', {
      type: 'String',
      default: 'v0.44.0',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/postgres-meta`,
    });

    // Condition
    const workMailEnabledCondition = new cdk.CfnCondition(this, 'WorkMailEnabledCondition', { expression: cdk.Fn.conditionEquals(workMailEnabledParameter, 'true') });

    // Resources
    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const mesh = (meshEnabled)
      ? new appmesh.Mesh(this, 'Mesh', {
        meshName: this.stackName,
        egressFilter: appmesh.MeshFilterType.ALLOW_ALL, // Need to exchange oauth external code
      })
      : undefined;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    const mail = new SupabaseMail(this, 'SupabaseMail', { region: sesRegionParameter.valueAsString, mesh });
    const workMail = new WorkMail(this, 'WorkMail', { region: sesRegionParameter.valueAsString, alias: `supabase-${cdk.Aws.ACCOUNT_ID}` });
    (workMail.node.defaultChild as cdk.CfnStack).addOverride('Condition', workMailEnabledCondition.logicalId);

    const smtpAdminEmail = cdk.Fn.conditionIf(workMailEnabledCondition.logicalId, `noreply@${workMail.domain}`, smtpAdminEmailParameter.valueAsString);
    const smtpHost = `email-smtp.${sesRegionParameter.valueAsString}.amazonaws.com`;

    const db = new SupabaseDatabase(this, 'Database', { vpc, mesh });
    const dbSecret = db.secret!;

    const jwt = new SupabaseJwt(this, 'SupabaseJwt', { issuer: 'supabase', expiresIn: '10y' });

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/kong:latest'),
        //image: ecs.ContainerImage.fromAsset('./src/containers/kong', { platform: Platform.LINUX_ARM64 }),
        portMappings: [{ containerPort: 8000 }, { containerPort: 8100 }],
        healthCheck: {
          command: ['CMD', 'kong', 'health'],
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(10),
          retries: 3,
        },
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl',
          KONG_STATUS_LISTEN: '0.0.0.0:8100',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSsmParameter(jwt.anonKey),
          SERVICE_KEY: ecs.Secret.fromSsmParameter(jwt.serviceRoleKey),
        },
      },
      mesh,
    });
    const kongLoadBalancer = kong.addNetworkLoadBalancer();

    const cfPrefixList = new ManagedPrefixList(this, 'CloudFrontManagedPrefixList', { name: 'com.amazonaws.global.cloudfront.origin-facing' });
    kong.ecsService.connections.allowFrom(Peer.prefixList(cfPrefixList.prefixListId), Port.tcp(kong.listenerPort), 'CloudFront');

    const cdn = new SupabaseCdn(this, 'Cdn', { origin: kongLoadBalancer, requestRateLimit: wafRequestRateLimitParameter.valueAsNumber });
    const apiExternalUrl = `https://${cdn.distribution.domainName}`;

    const auth = new SupabaseAuth(this, 'Auth', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/gotrue:${authApiVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 9999 }],
        environment: {
          // Top-Level - https://github.com/supabase/gotrue#top-level
          GOTRUE_SITE_URL: siteUrlParameter.valueAsString,
          GOTRUE_URI_ALLOW_LIST: redirectUrlsParameter.valueAsString,
          GOTRUE_DISABLE_SIGNUP: disableSignupParameter.valueAsString,
          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', // Amazon SNS not supported
          GOTRUE_RATE_LIMIT_EMAIL_SENT: '3600', // SES Limit: 1msg/s
          GOTRUE_PASSWORD_MIN_LENGTH: passwordMinLengthParameter.valueAsString,
          // API - https://github.com/supabase/gotrue#api
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          //API_EXTERNAL_URL: apiExternalUrl,
          // Database - https://github.com/supabase/gotrue#database
          GOTRUE_DB_DRIVER: 'postgres',
          // JWT - https://github.com/supabase/gotrue#json-web-tokens-jwt
          GOTRUE_JWT_EXP: jwtExpiryLimitParameter.valueAsString,
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          // E-Mail - https://github.com/supabase/gotrue#e-mail
          GOTRUE_SMTP_ADMIN_EMAIL: smtpAdminEmail.toString(),
          GOTRUE_SMTP_HOST: smtpHost,
          GOTRUE_SMTP_PORT: '465',
          GOTRUE_SMTP_SENDER_NAME: smtpSenderNameParameter.valueAsString,
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
      },
      apiExternalUrl,
      externalAuthProviders: ['Google', 'Facebook', 'Twitter', 'GitHub'],
      mesh,
    });
    //(auth.ecsService.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('ContainerDefinitions.0.Environment', smtpAdminEmail);

    const rest = new SupabaseService(this, 'Rest', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`postgrest/postgrest:${restApiVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 3000 }],
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
      mesh,
    });

    if (gqlEnabled) {
      // GraphQL - use postgraphile insted of pg_graphql
      const graphql = new SupabaseService(this, 'GraphQL', {
        cluster,
        containerDefinition: {
          image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/postgraphile:latest'),
          //image: ecs.ContainerImage.fromAsset('./src/containers/postgraphile', { platform: Platform.LINUX_ARM64 }),
          portMappings: [{ containerPort: 5000 }],
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
        mesh,
      });
      graphql.addDatabaseBackend(db);
      kong.addBackend(graphql);
      kong.ecsService.taskDefinition.defaultContainer!.addEnvironment('SUPABASE_GRAPHQL_URL', 'http://graphql.supabase.local:5000/graphql');
    }

    const realtime = new SupabaseService(this, 'Realtime', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/realtime:${realtimeApiVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 4000 }],
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
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
        command: ['bash', '-c', './prod/rel/realtime/bin/realtime eval Realtime.Release.migrate && ./prod/rel/realtime/bin/realtime start'],
      },
      autoScalingEnabled: false,
      mesh,
    });

    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const storage = new SupabaseService(this, 'Storage', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/storage-api:${storageApiVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 5000 }],
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
      },
      cpuArchitecture: ecs.CpuArchitecture.X86_64, // storage-api does not work on ARM64
      mesh,
    });
    bucket.grantReadWrite(storage.ecsService.taskDefinition.taskRole);

    const meta = new SupabaseService(this, 'Meta', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/postgres-meta:${postgresMetaApiVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 8080 }],
        environment: {
          PG_META_PORT: '8080',
        },
        secrets: {
          PG_META_DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          PG_META_DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          PG_META_DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
          PG_META_DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          PG_META_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
      },
      mesh,
    });

    kong.addBackend(auth);
    kong.addBackend(rest);
    kong.addBackend(realtime);
    kong.addBackend(storage);
    kong.addBackend(meta);

    auth.addBackend(rest);
    auth.addExternalBackend(mail);
    storage.addBackend(rest);

    auth.addDatabaseBackend(db);
    rest.addDatabaseBackend(db);
    realtime.addDatabaseBackend(db);
    storage.addDatabaseBackend(db);
    meta.addDatabaseBackend(db);

    // Supabase Studio
    const studioVersionParameter = new cdk.CfnParameter(this, 'StudioVersionParameter', {
      type: 'String',
      default: 'latest',
      allowedPattern: imageTagPattern,
      description: `Docker image tag - ${ecrGalleryUrl}/studio`,
      //description: 'Docker image tag - https://hub.docker.com/r/supabase/studio/tags',
    });

    const studio = new SupabaseStudio(this, 'Studio', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(`${ecrRegistry}/studio:${studioVersionParameter.valueAsString}`),
        portMappings: [{ containerPort: 3000 }],
        environment: {
          STUDIO_PG_META_URL: `${apiExternalUrl}/pg`,
          SUPABASE_URL: `${apiExternalUrl}`, // for API Docs
          SUPABASE_REST_URL: `${apiExternalUrl}/rest/v1/`,
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          SUPABASE_ANON_KEY: ecs.Secret.fromSsmParameter(jwt.anonKey),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSsmParameter(jwt.serviceRoleKey),
        },
      },
      cpu: 256,
      memory: 512,
    });

    this.exportValue(jwt.anonToken, { name: 'ApiKey' });
    this.exportValue(apiExternalUrl, { name: 'Url' });
    new cdk.CfnOutput(this, 'StudioUrl', { value: `http://${studio.loadBalancer.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'StudioUserPool', { value: `https://${cdk.Aws.REGION}.console.aws.amazon.com/cognito/v2/idp/user-pools/${studio.userPool.userPoolId}/users` });

    const cfnInterface = {
      ParameterGroups: [
        {
          Label: { default: 'Supabase - Auth Settings' },
          Parameters: [
            disableSignupParameter.logicalId,
            siteUrlParameter.logicalId,
            redirectUrlsParameter.logicalId,
            jwtExpiryLimitParameter.logicalId,
            passwordMinLengthParameter.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - Auth E-mail Settings' },
          Parameters: [
            smtpAdminEmailParameter.logicalId,
            smtpSenderNameParameter.logicalId,
            sesRegionParameter.logicalId,
            workMailEnabledParameter.logicalId,
          ],
        },
        {
          Label: { default: 'Platform Settings' },
          Parameters: [
            db.multiAzParameter.logicalId,
            wafRequestRateLimitParameter.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - API Versions' },
          Parameters: [
            authApiVersionParameter.logicalId,
            restApiVersionParameter.logicalId,
            realtimeApiVersionParameter.logicalId,
            storageApiVersionParameter.logicalId,
            postgresMetaApiVersionParameter.logicalId,
          ],
        },
        {
          Label: { default: 'Supabase - Studio Settings' },
          Parameters: [
            studioVersionParameter.logicalId,
            studio.acmCertArnParameter.logicalId,
          ],
        },
      ],
      ParameterLabels: {
        [disableSignupParameter.logicalId]: { default: 'Disable User Signups' },
        [siteUrlParameter.logicalId]: { default: 'Site URL' },
        [redirectUrlsParameter.logicalId]: { default: 'Redirect URLs' },
        [jwtExpiryLimitParameter.logicalId]: { default: 'JWT expiry limit' },
        [passwordMinLengthParameter.logicalId]: { default: 'Min password length' },
        [smtpAdminEmailParameter.logicalId]: { default: 'SMTP Admin Email Address' },
        [smtpSenderNameParameter.logicalId]: { default: 'SMTP Sender Name' },
        [sesRegionParameter.logicalId]: { default: 'Amazon SES Region' },
        [workMailEnabledParameter.logicalId]: { default: 'Enable Amazon WorkMail (Test E-mail Domain)' },
        [db.multiAzParameter.logicalId]: { default: 'Database Multi-AZ' },
        [wafRequestRateLimitParameter.logicalId]: { default: 'WAF Request Rate Limit' },
        [authApiVersionParameter.logicalId]: { default: 'Auth API Version - GoTrue' },
        [restApiVersionParameter.logicalId]: { default: 'Rest API Version - PostgREST' },
        [realtimeApiVersionParameter.logicalId]: { default: 'Realtime API Version' },
        [storageApiVersionParameter.logicalId]: { default: 'Storage API Version' },
        [postgresMetaApiVersionParameter.logicalId]: { default: 'Postgres Meta API Version' },
        [studioVersionParameter.logicalId]: { default: 'Supabase Studio Version' },
        [studio.acmCertArnParameter.logicalId]: { default: 'ACM Certificate ARN' },
      },
    };

    for (let i in auth.externalAuthProviders) {
      const provider = auth.externalAuthProviders[i];
      cfnInterface.ParameterGroups.push({
        Label: { default: `Supabase - External Auth Provider - ${provider.name}` },
        Parameters: [provider.enabledParameter.logicalId, provider.clientIdParameter.logicalId, provider.secretParameter.logicalId],
      });
      cfnInterface.ParameterLabels[provider.enabledParameter.logicalId] = { default: `${provider.name} Enabled` };
      cfnInterface.ParameterLabels[provider.clientIdParameter.logicalId] = { default: `${provider.name} Client ID` };
      cfnInterface.ParameterLabels[provider.secretParameter.logicalId] = { default: `${provider.name} Client Secret` };
    }

    // for CloudFormation
    this.templateOptions.description = 'Self-hosted Supabase';
    this.templateOptions.metadata = { 'AWS::CloudFormation::Interface': cfnInterface };

  }
}
