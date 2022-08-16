import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import { Vpc, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as xray from 'aws-cdk-lib/aws-xray';
import { Construct } from 'constructs';
import { ManagedPrefixList } from './managed-prefix-list';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseJwtSecret } from './supabase-jwt-secret';
import { SupabaseMail } from './supabase-mail';
import { SupabaseService } from './supabase-service';
import { SupabaseStudio } from './supabase-studio';
import { sesSmtpSupportedRegions } from './utils';

export class SupabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    const sesRegion = new cdk.CfnParameter(this, 'SesRegion', {
      description: 'Region of SES endpoint used as SMTP server.',
      type: 'String',
      default: 'us-west-2',
      allowedValues: sesSmtpSupportedRegions,
    });

    const smtpAdminEmail = new cdk.CfnParameter(this, 'SmtpAdminEmail', {
      description: 'The From email address for all emails sent.',
      type: 'String',
      default: 'noreply@supabase.awsapps.com',
      //allowedPattern: '/[^\s@]+@[^\s@]+\.[^\s@]+/',
    });

    const smtpSenderName = new cdk.CfnParameter(this, 'SmtpSenderName', {
      description: 'The From email sender name for all emails sent.',
      type: 'String',
      default: 'Supabase',
    });

    const supabaseKongImage = new cdk.CfnParameter(this, 'SupabaseKongImage', { type: 'String', default: 'public.ecr.aws/u3p7q2r8/supabase-kong:latest' });
    const supabaseAuthImage = new cdk.CfnParameter(this, 'SupabaseAuthImage', { type: 'String', default: 'supabase/gotrue:v2.10.3' });
    const supabaseResrImage = new cdk.CfnParameter(this, 'SupabaseResrImage', { type: 'String', default: 'postgrest/postgrest:v9.0.1' });
    const supabaseRealtimeImage = new cdk.CfnParameter(this, 'SupabaseRealtimeImage', { type: 'String', default: 'supabase/realtime:v0.24.0' });
    const supabaseStorageImage = new cdk.CfnParameter(this, 'SupabaseStorageImage', { type: 'String', default: 'supabase/storage-api:v0.19.0' });
    const supabaseMetaImage = new cdk.CfnParameter(this, 'SupabaseMetaImage', { type: 'String', default: 'supabase/postgres-meta:v0.42.1' });

    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const mesh = new appmesh.Mesh(this, 'Mesh', {
      meshName: this.stackName,
      egressFilter: appmesh.MeshFilterType.ALLOW_ALL,
    });
    new xray.CfnGroup(this, 'XrayGroup', {
      groupName: mesh.meshName,
      filterExpression: `annotation.node_id BEGINSWITH "mesh/${mesh.meshName}/"`,
      insightsConfiguration: { insightsEnabled: true },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    const mail = new SupabaseMail(this, 'SupabaseMail', { region: sesRegion.valueAsString, email: smtpAdminEmail.valueAsString, mesh });

    const db = new SupabaseDatabase(this, 'DB', { vpc, mesh });
    const dbSecret = db.secret!;

    const jwtSecret = new SupabaseJwtSecret(this, 'SupabaseJwtSecret');

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseKongImage.valueAsString),
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
          ANON_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'anon_key'),
          SERVICE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'service_role_key'),
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
        image: ecs.ContainerImage.fromRegistry(supabaseAuthImage.valueAsString),
        portMappings: [{ containerPort: 9999 }],
        environment: {
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          API_EXTERNAL_URL: `https://${cdn.distribution.domainName}`,
          GOTRUE_DB_DRIVER: 'postgres',
          GOTRUE_SITE_URL: 'http://localhost:3000',
          GOTRUE_URI_ALLOW_LIST: '',
          GOTRUE_DISABLE_SIGNUP: 'false',
          // JWT
          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          GOTRUE_JWT_EXP: '3600',
          // mail
          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          GOTRUE_MAILER_AUTOCONFIRM: 'false',
          GOTRUE_SMTP_HOST: `email-smtp.${sesRegion.valueAsString}.amazonaws.com`,
          GOTRUE_SMTP_PORT: '465',
          GOTRUE_SMTP_ADMIN_EMAIL: smtpAdminEmail.valueAsString,
          GOTRUE_SMTP_SENDER_NAME: smtpSenderName.valueAsString,
          GOTRUE_MAILER_URLPATHS_INVITE: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
          GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',
          // other
          GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
          GOTRUE_SMS_AUTOCONFIRM: 'true',
        },
        secrets: {
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret, 'url_auth'),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'jwt_secret'),
          GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(mail.secret, 'username'),
          GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(mail.secret, 'password'),
        },
      },
      mesh,
    });

    const rest = new SupabaseService(this, 'Rest', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseResrImage.valueAsString),
        portMappings: [{ containerPort: 3000 }],
        environment: {
          PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_USE_LEGACY_GUCS: 'false',
        },
        secrets: {
          PGRST_DB_URI: ecs.Secret.fromSecretsManager(dbSecret, 'url'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'jwt_secret'),
        },
      },
      mesh,
    });

    const realtime = new SupabaseService(this, 'Realtime', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseRealtimeImage.valueAsString),
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
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'jwt_secret'),
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
        command: ['bash', '-c', './prod/rel/realtime/bin/realtime eval Realtime.Release.migrate && ./prod/rel/realtime/bin/realtime start'],
      },
      mesh,
    });

    const bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const storage = new SupabaseService(this, 'Storage', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseStorageImage.valueAsString),
        portMappings: [{ containerPort: 5000 }],
        environment: {
          POSTGREST_URL: 'http://rest.supabase.local:3000',
          PGOPTIONS: '-c search_path=storage,public',
          FILE_SIZE_LIMIT: '52428800',
          STORAGE_BACKEND: 's3', // default: file
          FILE_STORAGE_BACKEND_PATH: './data',
          TENANT_ID: 'stub',
          // TODO: https://github.com/supabase/storage-api/issues/55
          REGION: bucket.env.region,
          GLOBAL_S3_BUCKET: bucket.bucketName,
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'anon_key'),
          SERVICE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'service_role_key'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'jwt_secret'),
          DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret, 'url'),
        },
      },
      memory: 1024, // patch for supabase-storage
      cpuArchitecture: ecs.CpuArchitecture.X86_64, // patch for supabase-storage
      mesh,
    });
    bucket.grantReadWrite(storage.ecsService.taskDefinition.taskRole);

    const meta = new SupabaseService(this, 'Meta', {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseMetaImage.valueAsString),
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

    const studio = new SupabaseStudio(this, 'Studio', {
      cluster,
      dbSecret,
      jwtSecret,
      supabaseUrl: `https://${cdn.distribution.domainName}`,
    });

    new cdk.CfnOutput(this, 'Url', { value: `https://${cdn.distribution.domainName}` });
    new cdk.CfnOutput(this, 'StudioUrl', { value: `http://${studio.loadBalancer.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'StudioUserPool', { value: `https://${cdk.Aws.REGION}.console.aws.amazon.com/cognito/v2/idp/user-pools/${studio.userPool.userPoolId}/users` });

  }
}
