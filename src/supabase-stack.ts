import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ExternalAuthProvider, ExternalAuthProviderProps } from './external-auth-provicer';
import { ManagedPrefixList } from './managed-prefix-list';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseJwt } from './supabase-jwt';
import { SupabaseMail } from './supabase-mail';
import { SupabaseService } from './supabase-service';
import { SupabaseStudio } from './supabase-studio';
import { sesSmtpSupportedRegions } from './utils';

const ecrPublicAlias = 't3w2s2c9';
const ecsPublicRegistry = `public.ecr.aws/${ecrPublicAlias}`;

interface SupabaseStackProps extends cdk.StackProps {
  meshEnabled?: boolean;
  gqlEnabled?: boolean;
}

export class SupabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SupabaseStackProps = {}) {
    super(scope, id, props);

    const { meshEnabled, gqlEnabled } = props;

    const disableSignupParameter = new cdk.CfnParameter(this, 'DisableSignup', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const siteUrlParameter = new cdk.CfnParameter(this, 'SiteUrl', {
      description: 'The base URL your site is located at. Currently used in combination with other settings to construct URLs used in emails.',
      type: 'String',
      default: 'http://localhost:3000',
    });

    const jwtExpiryLimitParameter = new cdk.CfnParameter(this, 'JWTExpiryLimit', {
      description: 'How long tokens are valid for. Defaults to 3600 (1 hour), maximum 604,800 seconds (one week).',
      type: 'Number',
      default: 3600,
      minValue: 300,
      maxValue: 604800,
    });

    const passwordMinLengthParameter = new cdk.CfnParameter(this, 'PasswordMinLength', {
      description: 'When signup is disabled the only way to create new users is through invites. Defaults to false, all signups enabled.',
      type: 'Number',
      default: '16',
      minValue: 8,
      maxValue: 128,
    });

    const sesRegionParameter = new cdk.CfnParameter(this, 'SesRegion', {
      description: 'Region of SES endpoint used as SMTP server.',
      type: 'String',
      default: 'us-west-2',
      allowedValues: sesSmtpSupportedRegions,
    });

    const smtpAdminEmailParameter = new cdk.CfnParameter(this, 'SmtpAdminEmail', {
      description: 'The From email address for all emails sent.',
      type: 'String',
      default: 'noreply@supabase.awsapps.com',
      allowedPattern: '^[\\x20-\\x45]?[\\w-\\+]+(\\.[\\w]+)*@[\\w-]+(\\.[\\w]+)*(\\.[a-z]{2,})$',
      constraintDescription: 'must be a valid email address',
    });

    const smtpSenderNameParameter = new cdk.CfnParameter(this, 'SmtpSenderName', {
      description: 'The From email sender name for all emails sent.',
      type: 'String',
      default: 'Supabase',
    });

    const supabaseKongImageParameter = new cdk.CfnParameter(this, 'SupabaseKongImage', { type: 'String', default: 'public.ecr.aws/u3p7q2r8/kong:latest' });
    const supabaseAuthImageParameter = new cdk.CfnParameter(this, 'SupabaseAuthImage', { type: 'String', default: `${ecsPublicRegistry}/gotrue:v2.15.4` });
    const supabaseResrImageParameter = new cdk.CfnParameter(this, 'SupabaseResrImage', { type: 'String', default: 'postgrest/postgrest:v9.0.1' });
    const supabaseRealtimeImageParameter = new cdk.CfnParameter(this, 'SupabaseRealtimeImage', { type: 'String', default: `${ecsPublicRegistry}/realtime:v0.24.1` });
    const supabaseStorageImageParameter = new cdk.CfnParameter(this, 'SupabaseStorageImage', { type: 'String', default: `${ecsPublicRegistry}/storage-api:v0.19.1` });
    const supabaseMetaImageParameter = new cdk.CfnParameter(this, 'SupabaseMetaImage', { type: 'String', default: `${ecsPublicRegistry}/postgres-meta:v0.42.3` });

    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const mesh = (meshEnabled)
      ? new appmesh.Mesh(this, 'Mesh', {
        meshName: this.stackName,
        egressFilter: appmesh.MeshFilterType.ALLOW_ALL,
      })
      : undefined;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      containerInsights: false,
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    const mail = new SupabaseMail(this, 'SupabaseMail', { region: sesRegionParameter.valueAsString, mesh });

    const db = new SupabaseDatabase(this, 'DB', { vpc, mesh });
    const dbSecret = db.secret!;

    const jwt = new SupabaseJwt(this, 'SupabaseJwt', { issuer: 'supabase', expiresIn: '10y' });

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseKongImageParameter.valueAsString),
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

    const cdn = new SupabaseCdn(this, 'CDN', { originLoadBalancer: kongLoadBalancer });
    const cfPrefixList = new ManagedPrefixList(this, 'CloudFrontManagedPrefixList', { name: 'com.amazonaws.global.cloudfront.origin-facing' });
    kong.ecsService.connections.allowFrom(Peer.prefixList(cfPrefixList.prefixListId), Port.tcp(kong.listenerPort), 'CloudFront');

    const auth = new SupabaseService(this, 'Auth', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseAuthImageParameter.valueAsString),
        portMappings: [{ containerPort: 9999 }],
        environment: {
          // Top-Level - https://github.com/supabase/gotrue#top-level
          GOTRUE_SITE_URL: siteUrlParameter.valueAsString,
          GOTRUE_URI_ALLOW_LIST: '',
          GOTRUE_DISABLE_SIGNUP: disableSignupParameter.valueAsString,
          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', // Amazon SNS not supported
          GOTRUE_RATE_LIMIT_EMAIL_SENT: '3600', // SES Limit: 1msg/s
          GOTRUE_PASSWORD_MIN_LENGTH: passwordMinLengthParameter.valueAsString,
          // API - https://github.com/supabase/gotrue#api
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          API_EXTERNAL_URL: `https://${cdn.distribution.domainName}`,
          // Database - https://github.com/supabase/gotrue#database
          GOTRUE_DB_DRIVER: 'postgres',
          // JWT - https://github.com/supabase/gotrue#json-web-tokens-jwt
          GOTRUE_JWT_EXP: jwtExpiryLimitParameter.valueAsString,
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          // E-Mail - https://github.com/supabase/gotrue#e-mail
          GOTRUE_SMTP_ADMIN_EMAIL: smtpAdminEmailParameter.valueAsString,
          GOTRUE_SMTP_HOST: `email-smtp.${sesRegionParameter.valueAsString}.amazonaws.com`,
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
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSsmParameter(db.urlAuth),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(mail.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(mail.secret, 'password'),
        },
      },
      mesh,
    });

    const rest = new SupabaseService(this, 'Rest', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseResrImageParameter.valueAsString),
        portMappings: [{ containerPort: 3000 }],
        environment: {
          PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_USE_LEGACY_GUCS: 'false',
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSsmParameter(db.url),
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
            DATABASE_URL: ecs.Secret.fromSsmParameter(db.url),
            JWT_SECRET: ecs.Secret.fromSecretsManager(jwt.secret),
          },
        },
        mesh,
      });
      graphql.addDatabaseBackend(db);
      kong.addBackend(graphql);
      kong.ecsService.taskDefinition.defaultContainer?.addEnvironment('SUPABASE_GRAPHQL_URL', 'http://graphql.supabase.local:5000/graphql');
    }

    const realtime = new SupabaseService(this, 'Realtime', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseRealtimeImageParameter.valueAsString),
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
        image: ecs.ContainerImage.fromRegistry(supabaseStorageImageParameter.valueAsString),
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
          DATABASE_URL: ecs.Secret.fromSsmParameter(db.url),
        },
      },
      cpuArchitecture: ecs.CpuArchitecture.X86_64, // storage-api does not work on ARM64
      mesh,
    });
    bucket.grantReadWrite(storage.ecsService.taskDefinition.taskRole);

    const meta = new SupabaseService(this, 'Meta', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseMetaImageParameter.valueAsString),
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
    const supabaseStudioImageParameter = new cdk.CfnParameter(this, 'SupabaseStudioImage', {
      type: 'String',
      default: 'public.ecr.aws/t3w2s2c9/studio:latest',
    });

    const studio = new SupabaseStudio(this, 'Studio', {
      cluster,
      dbSecret,
      anonKey: jwt.anonKey,
      serviceRoleKey: jwt.serviceRoleKey,
      imageUri: supabaseStudioImageParameter.valueAsString,
      supabaseUrl: `https://${cdn.distribution.domainName}`,
    });
    studio.addDatabaseBackend(db);

    this.exportValue(jwt.anonToken, { name: 'ApiKey' });
    this.exportValue(`https://${cdn.distribution.domainName}`, { name: 'Url' });
    new cdk.CfnOutput(this, 'StudioUrl', { value: `http://${studio.loadBalancer.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'StudioUserPool', { value: `https://${cdk.Aws.REGION}.console.aws.amazon.com/cognito/v2/idp/user-pools/${studio.userPool.userPoolId}/users` });

    // for CloudFormation
    this.templateOptions.description = 'Self-hosted Supabase powered by ECS Fargate, Aurora Serverless v2, App Mesh and X-Ray';
    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: { default: 'Supabase - Auth Settings' },
            Parameters: [
              disableSignupParameter.logicalId,
              siteUrlParameter.logicalId,
              jwtExpiryLimitParameter.logicalId,
              passwordMinLengthParameter.logicalId,
            ],
          },
          {
            Label: { default: 'Supabase - Auth E-mail Settings' },
            Parameters: [
              sesRegionParameter.logicalId,
              smtpAdminEmailParameter.logicalId,
              smtpSenderNameParameter.logicalId,
            ],
          },
          {
            Label: { default: 'Platform Settings' },
            Parameters: [
              db.multiAzParameter.logicalId,
              cdn.wafWebAclArnParameter.logicalId,
            ],
          },
          {
            Label: { default: 'Docker Images' },
            Parameters: [
              supabaseKongImageParameter.logicalId,
              supabaseAuthImageParameter.logicalId,
              supabaseResrImageParameter.logicalId,
              supabaseRealtimeImageParameter.logicalId,
              supabaseStorageImageParameter.logicalId,
              supabaseMetaImageParameter.logicalId,
            ],
          },
          {
            Label: { default: 'Supabase - Studio Settings' },
            Parameters: [
              supabaseStudioImageParameter.logicalId,
              studio.acmCertArnParameter.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [disableSignupParameter.logicalId]: { default: 'Disable User Signups' },
          [siteUrlParameter.logicalId]: { default: 'Site URL' },
          [jwtExpiryLimitParameter.logicalId]: { default: 'JWT expiry limit' },
          [passwordMinLengthParameter.logicalId]: { default: 'Min password length' },
          [sesRegionParameter.logicalId]: { default: 'Amazon SES Region' },
          [smtpAdminEmailParameter.logicalId]: { default: 'SMTP Admin Email Address' },
          [smtpSenderNameParameter.logicalId]: { default: 'SMTP Sender Name' },
          [db.multiAzParameter.logicalId]: { default: 'Database Multi-AZ' },
          [cdn.wafWebAclArnParameter.logicalId]: { default: 'WAF Web ACL ARN' },
        },
      },
    };

    const extAuthProps: ExternalAuthProviderProps = {
      apiExternalUrl: `https://${cdn.distribution.domainName}`,
      authService: auth,
      metadata: this.templateOptions.metadata,
    };
    //new ExternalAuthProvider(this, 'Apple', extAuthProps);
    new ExternalAuthProvider(this, 'Google', extAuthProps);
    new ExternalAuthProvider(this, 'Facebook', extAuthProps);
    new ExternalAuthProvider(this, 'Twitter', extAuthProps);
    new ExternalAuthProvider(this, 'GitHub', extAuthProps);
  }
}
