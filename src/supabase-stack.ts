import { Stack, StackProps, SecretValue, CfnOutput } from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Vpc, Port } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
//import jwt from 'jsonwebtoken';
import { SupabaseCdn } from './supabase-cdn';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseService } from './supabase-service';

export class SupabaseStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', { natGateways: 1 });

    const db = new SupabaseDatabase(this, 'DB', { vpc });
    const dbSecret = db.secret!;

    //const jwtSecret = new Secret(this, 'SupabaseJwtSecret', { generateSecretString: { passwordLength: 64, excludePunctuation: true } });

    const supabaseSecret = new Secret(this, 'SupabaseSecret', {
      secretObjectValue: {
        JWT_SECRET: SecretValue.unsafePlainText('your-super-secret-jwt-token-with-at-least-32-characters-long'),
        ANON_KEY: SecretValue.unsafePlainText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE'),
        SERVICE_ROLE_KEY: SecretValue.unsafePlainText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q'),
        //JWT_SECRET: jwtSecret.secretValue,
        //ANON_KEY: SecretValue.unsafePlainText(jwt.sign({
        //  role: 'anon',
        //  iss: 'supabase',
        //  iat: 1658588400,
        //  exp: 1816354800,
        //}, jwtSecret.secretValue.toString())),
        //SERVICE_ROLE_KEY: SecretValue.unsafePlainText(jwt.sign({
        //  role: 'service_role',
        //  iss: 'supabase',
        //  iat: 1658588400,
        //  exp: 1816354800,
        //}, jwtSecret.secretValue.toString())),
        GOTRUE_DB_DATABASE_URL: SecretValue.unsafePlainText(`postgres://${dbSecret.secretValueFromJson('username')}:${dbSecret.secretValueFromJson('password')}@${dbSecret.secretValueFromJson('host')}:${dbSecret.secretValueFromJson('port')}/${dbSecret.secretValueFromJson('dbname')}?search_path=auth`),
        PGRST_DB_URI: SecretValue.unsafePlainText(`postgres://${dbSecret.secretValueFromJson('username')}:${dbSecret.secretValueFromJson('password')}@${dbSecret.secretValueFromJson('host')}:${dbSecret.secretValueFromJson('port')}/${dbSecret.secretValueFromJson('dbname')}`),
      },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      defaultCloudMapNamespace: { name: 'supabase.local' },
      vpc,
    });

    const kong = new SupabaseService(this, 'Kong', {
      cluster,
      containerDefinition: {
        containerName: 'supabase-kong',
        //image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/kong:2.7'),
        image: ecs.ContainerImage.fromAsset('./src/containers/kong', {
          platform: Platform.LINUX_ARM64,
        }),
        portMappings: [{ containerPort: 8000 }],
        environment: {
          KONG_DATABASE: 'off',
          KONG_DECLARATIVE_CONFIG: '/var/lib/kong/kong.yml',
          KONG_DNS_ORDER: 'LAST,A,CNAME',
          KONG_PLUGINS: 'request-transformer,cors,key-auth,acl',
          KONG_VAULTS: 'bundled',
        },
        secrets: {
          SUPABASE_ANON_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'ANON_KEY'),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'SERVICE_ROLE_KEY'),
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
          GOTRUE_DB_DATABASE_URL: ecs.Secret.fromSecretsManager(supabaseSecret, 'GOTRUE_DB_DATABASE_URL'),
          GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(supabaseSecret, 'JWT_SECRET'),
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
          PGRST_DB_URI: ecs.Secret.fromSecretsManager(supabaseSecret, 'PGRST_DB_URI'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(supabaseSecret, 'JWT_SECRET'),
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
          JWT_SECRET: ecs.Secret.fromSecretsManager(supabaseSecret, 'JWT_SECRET'),
          DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
        command: ['bash', '-c', './prod/rel/realtime/bin/realtime eval Realtime.Release.migrate && ./prod/rel/realtime/bin/realtime start'],
      },
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
          STORAGE_BACKEND: 'file',
          FILE_STORAGE_BACKEND_PATH: '/var/lib/storage',
          TENANT_ID: 'stub',
          // TODO: https://github.com/supabase/storage-api/issues/55
          REGION: 'stub',
          GLOBAL_S3_BUCKET: 'stub',
        },
        secrets: {
          ANON_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'ANON_KEY'),
          SERVICE_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'SERVICE_ROLE_KEY'),
          PGRST_JWT_SECRET: ecs.Secret.fromSecretsManager(supabaseSecret, 'JWT_SECRET'),
          DATABASE_URL: ecs.Secret.fromSecretsManager(supabaseSecret, 'PGRST_DB_URI'),
        },
      },
    });

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
    kong.service.connections.allowTo(meta.service, Port.tcp(8080));

    auth.service.connections.allowTo(rest.service, Port.tcp(3000));

    storage.service.connections.allowTo(rest.service, Port.tcp(3000));

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
          SUPABASE_ANON_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'ANON_KEY'),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSecretsManager(supabaseSecret, 'SERVICE_ROLE_KEY'),
        },
      },
      gateway: 'alb',
    });

    const studioCdn = new SupabaseCdn(this, 'StudioCDN', { originLoadBalancer: studio.loadBalancer! });

    new CfnOutput(this, 'StudioUrl', { value: `https://${studioCdn.domainName}` });

  }
}
