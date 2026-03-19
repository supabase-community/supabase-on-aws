import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const excludeCharacters = '%+~`#$&*()|[]{}:;<>?!\'/@\"\\=^,';

export interface SupabaseDbInitProps {
  vpc: ec2.IVpc;
  databaseAdminSecret: secretsmanager.ISecret;
  databaseSecurityGroup: ec2.ISecurityGroup;
  databaseEndpoint: { hostname: string; port: number };
  jwtSecret: secretsmanager.ISecret;
  jwtExp: number;
}

export class SupabaseDbInit extends Construct {
  readonly migration: cdk.CustomResource;

  /** Secret for supabase_auth_admin */
  readonly supabaseAuthAdminSecret: secretsmanager.Secret;
  /** Secret for supabase_storage_admin */
  readonly supabaseStorageAdminSecret: secretsmanager.Secret;
  /** Secret for authenticator */
  readonly authenticatorSecret: secretsmanager.Secret;
  /** Secret for dashboard_user */
  readonly dashboardUserSecret: secretsmanager.Secret;
  /** Secret for postgres */
  readonly postgresSecret: secretsmanager.Secret;
  /** Secret for supabase_functions_admin */
  readonly supabaseFunctionsAdminSecret: secretsmanager.Secret;
  /** Secret for pgbouncer */
  readonly pgbouncerSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SupabaseDbInitProps) {
    super(scope, id);

    const { vpc, databaseAdminSecret, databaseSecurityGroup, databaseEndpoint, jwtSecret, jwtExp } = props;

    // Generate secrets for each DB user
    const usernames = [
      'supabase_auth_admin',
      'supabase_storage_admin',
      'authenticator',
      'dashboard_user',
      'postgres',
      'supabase_functions_admin',
      'pgbouncer',
    ] as const;

    const secrets: Record<string, secretsmanager.Secret> = {};
    const userSecretConfigs: { username: string; secretArn: string }[] = [];

    for (const username of usernames) {
      const secret = new secretsmanager.Secret(this, `Secret-${username}`, {
        secretName: `${cdk.Aws.STACK_NAME}-${id}-${username}`,
        description: `Supabase - Database User ${username}`,
        generateSecretString: {
          excludeCharacters,
          excludePunctuation: true,
          secretStringTemplate: JSON.stringify({ username }),
          generateStringKey: 'password',
        },
      });
      secrets[username] = secret;
      userSecretConfigs.push({ username, secretArn: secret.secretArn });
    }

    this.supabaseAuthAdminSecret = secrets['supabase_auth_admin'];
    this.supabaseStorageAdminSecret = secrets['supabase_storage_admin'];
    this.authenticatorSecret = secrets['authenticator'];
    this.dashboardUserSecret = secrets['dashboard_user'];
    this.postgresSecret = secrets['postgres'];
    this.supabaseFunctionsAdminSecret = secrets['supabase_functions_admin'];
    this.pgbouncerSecret = secrets['pgbouncer'];

    const dbInitFunction = new NodejsFunction(this, 'DbInitFunction', {
      description: 'Supabase - Database initialization function',
      entry: path.resolve(__dirname, 'cr-db-init-handler.ts'),
      bundling: {
        nodeModules: ['@databases/pg'],
        commandHooks: {
          beforeInstall: () => [],
          beforeBundling: () => [],
          afterBundling: (inputDir, outputDir) => {
            return [
              `cp -rp ${inputDir}/src/supabase-db-init/sql ${outputDir}/sql`,
            ];
          },
        },
      },
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      environment: {
        DB_SECRET_ARN: databaseAdminSecret.secretArn,
        JWT_SECRET_ARN: jwtSecret.secretArn,
        JWT_EXP: jwtExp.toString(),
        USER_SECRETS: JSON.stringify(userSecretConfigs),
      },
      vpc,
    });

    // Allow Lambda to connect to database
    dbInitFunction.connections.allowTo(databaseSecurityGroup, ec2.Port.tcp(databaseEndpoint.port));

    // Allow Lambda to read admin secret and jwt secret
    databaseAdminSecret.grantRead(dbInitFunction);
    jwtSecret.grantRead(dbInitFunction);

    // Allow Lambda to read/write user secrets
    dbInitFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
      ],
      resources: userSecretConfigs.map(c => c.secretArn),
    }));

    const dbInitProvider = new cr.Provider(this, 'DbInitProvider', { onEventHandler: dbInitFunction });

    this.migration = new cdk.CustomResource(this, 'Migration', {
      serviceToken: dbInitProvider.serviceToken,
      resourceType: 'Custom::DatabaseInit',
      properties: {
        Fingerprint: cdk.FileSystem.fingerprint(path.resolve(__dirname, 'sql')),
      },
    });
  }
}
