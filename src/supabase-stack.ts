import { Stack, StackProps, SecretValue, CfnOutput } from 'aws-cdk-lib';
//import * as cf from 'aws-cdk-lib/aws-cloudfront';
//import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Vpc, Port } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseJwtSecret } from './supabase-jwt-secret';
import { SupabaseService } from './supabase-service';

export class SupabaseStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const db = new SupabaseDatabase(this, 'DB', { vpc });
    const dbSecret = db.secret!;

    const jwtSecret = new SupabaseJwtSecret(this, 'SupabaseJwtSecret');

    const cluster = new ecs.Cluster(this, 'Cluster', {
      enableFargateCapacityProviders: true,
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-kong',
        //image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/kong:2.8'),
        image: ecs.ContainerImage.fromAsset('./src/containers/kong', {
          platform: Platform.LINUX_ARM64,
        }),
        portMappings: [{ containerPort: 8000 }],
        environment: {
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'anon_key'),
          SERVICE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'service_role_key'),
        },
      },
      gateway: 'nlb',
    });

    const cdn = new SupabaseCdn(this, 'CDN', { originLoadBalancer: kong.loadBalancer! });

    const auth = new SupabaseService(this, 'Auth', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-auth',
        image: ecs.ContainerImage.fromRegistry('supabase/gotrue:v2.9.2'),
        portMappings: [{ containerPort: 9999 }],
        environment: {
          GOTRUE_API_HOST: '0.0.0.0',
          GOTRUE_API_PORT: '9999',
          API_EXTERNAL_URL: `https://${cdn.domainName}`,
          GOTRUE_DB_DRIVER: 'postgres',
          GOTRUE_SITE_URL: `http://${kong.loadBalancer?.loadBalancerDnsName}`,
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
          GOTRUE_SMTP_ADMIN_EMAIL: 'admin@example.com',
          GOTRUE_SMTP_HOST: 'mail',
          GOTRUE_SMTP_PORT: '2500',
          GOTRUE_SMTP_USER: 'fake_mail_user',
          GOTRUE_SMTP_PASS: 'fake_mail_password',
          GOTRUE_SMTP_SENDER_NAME: 'fake_sender',
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
        },
      },
    });

    const rest = new SupabaseService(this, 'Rest', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-rest',
        image: ecs.ContainerImage.fromRegistry('postgrest/postgrest:v9.0.1'),
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
    });

    const realtime = new SupabaseService(this, 'Realtime', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-realtime',
        image: ecs.ContainerImage.fromRegistry('supabase/realtime:v0.22.7'),
        portMappings: [{ containerPort: 4000 }],
        environment: {
          DB_SSL: 'false',
          PORT: '4000',
          REPLICATION_MODE: 'RLS',
          REPLICATION_POLL_INTERVAL: '100',
          SECURE_CHANNELS: 'true',
          SLOT_NAME: 'supabase_realtime_rls',
          TEMPORARY_SLOT: 'true',
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
    });

    const bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const storage = new SupabaseService(this, 'Storage', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-storage',
        image: ecs.ContainerImage.fromRegistry('supabase/storage-api:v0.18.6'),
        portMappings: [{ containerPort: 8080 }],
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
    });
    bucket.grantReadWrite(storage.service.taskDefinition.taskRole);

    const meta = new SupabaseService(this, 'Meta', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-meta',
        image: ecs.ContainerImage.fromRegistry('supabase/postgres-meta:v0.41.0'),
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
    });

    kong.service.connections.allowTo(auth.service, Port.tcp(9999));
    kong.service.connections.allowTo(rest.service, Port.tcp(3000));
    kong.service.connections.allowTo(realtime.service, Port.tcp(4000));
    kong.service.connections.allowTo(storage.service, Port.tcp(8080));
    kong.service.connections.allowTo(meta.service, Port.tcp(8080));

    rest.service.connections.allowFrom(auth.service, Port.tcp(3000));
    rest.service.connections.allowFrom(storage.service, Port.tcp(3000));

    db.connections.allowDefaultPortFrom(auth.service);
    db.connections.allowDefaultPortFrom(rest.service);
    db.connections.allowDefaultPortFrom(realtime.service);
    db.connections.allowDefaultPortFrom(storage.service);
    db.connections.allowDefaultPortFrom(meta.service);

    const studio = new SupabaseService(this, 'Studio', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-studio',
        image: ecs.ContainerImage.fromRegistry('supabase/studio:latest'),
        portMappings: [{ containerPort: 3000 }],
        environment: {
          STUDIO_PG_META_URL: `https://${cdn.domainName}/pg/`,
          SUPABASE_URL: `https://${cdn.domainName}`,
          SUPABASE_REST_URL: `https://${cdn.domainName}/rest/v1/`,
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          SUPABASE_ANON_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'anon_key'),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'service_role_key'),
        },
      },
      gateway: 'alb',
    });

    const studioCdn = new SupabaseCdn(this, 'StudioCDN', { originLoadBalancer: studio.loadBalancer! });

    new CfnOutput(this, 'StudioUrl', { value: `https://${studioCdn.domainName}` });

  }
}
