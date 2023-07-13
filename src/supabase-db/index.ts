import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const excludeCharacters = '%+~`#$&*()|[]{}:;<>?!\'/@\"\\=^,'; // for Password

interface SupabaseDatabaseProps {
  vpc: ec2.IVpc;
  highAvailability?: cdk.CfnCondition;
}

export class SupabaseDatabase extends Construct {
  /** RDS Instance */
  instance: rds.DatabaseInstance;

  /** Aurora Cluster */
  //cluster: rds.DatabaseCluster;

  /** Database migration */
  migration: cdk.CustomResource;

  /** Custom resource provider to generate user password */
  userPasswordProvider: cr.Provider;

  /** PostgreSQL for Supabase */
  constructor(scope: Construct, id: string, props: SupabaseDatabaseProps) {
    super(scope, id);

    const { vpc, highAvailability } = props;

    /** Database Engine */
    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 });

    /** Parameter Group */
    const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
      engine,
      description: 'Parameter group for Supabase',
      parameters: {
        'rds.force_ssl': '0',
        'shared_preload_libraries': 'pg_tle, plrust, pg_stat_statements, pgaudit, pg_cron',
        'rds.logical_replication': '1',
        'max_slot_wal_keep_size': '1024', // https://github.com/supabase/realtime
      },
    });

    this.instance = new rds.DatabaseInstance(this, 'Instance', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      engine,
      parameterGroup,
      vpc,
      multiAz: true,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 200,
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin', {
        secretName: `${cdk.Aws.STACK_NAME}-${id}-supabase_admin`,
      }),
      databaseName: 'postgres',
      storageEncrypted: true,
    });

    /** CFn resource for overwrite */
    const instance = this.instance.node.defaultChild! as rds.CfnDBInstance;

    if (typeof highAvailability !== 'undefined') {
      instance.multiAz = cdk.Fn.conditionIf(highAvailability.logicalId, true, false);
    }

    /** Custom resource handler for database migration */
    const migrationFunction = new NodejsFunction(this, 'MigrationFunction', {
      description: 'Supabase - Database migration function',
      entry: path.resolve(__dirname, 'cr-migrations-handler.ts'),
      bundling: {
        nodeModules: [
          '@databases/pg',
        ],
        commandHooks: {
          beforeInstall: (_inputDir, _outputDir) => {
            return [];
          },
          beforeBundling: (_inputDir, _outputDir) => {
            return [];
          },
          afterBundling: (inputDir, outputDir) => {
            return [
              `cp -rp ${inputDir}/src/supabase-db/sql/* ${outputDir}/`,
            ];
          },
        },
      },
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(60),
      environment: {
        DB_SECRET_ARN: this.instance.secret!.secretArn,
      },
      vpc,
    });

    // Allow a function to connect to database
    migrationFunction.connections.allowToDefaultPort(this.instance);

    // Allow a function to read db secret
    this.instance.secret?.grantRead(migrationFunction);

    /** Custom resource provider for database migration */
    const migrationProvider = new cr.Provider(this, 'MigrationProvider', { onEventHandler: migrationFunction });

    /** Database migration */
    this.migration = new cdk.CustomResource(this, 'Migration', {
      serviceToken: migrationProvider.serviceToken,
      resourceType: 'Custom::DatabaseMigration',
      properties: {
        Fingerprint: cdk.FileSystem.fingerprint(path.resolve(__dirname, 'sql')),
      },
    });

    // Wait until the database is ready.
    this.migration.node.addDependency(instance);

    /** Custom resource handler to modify db user password */
    const userPasswordFunction = new NodejsFunction(this, 'UserPasswordFunction', {
      description: 'Supabase - DB user password function',
      entry: path.resolve(__dirname, 'cr-user-password-handler.ts'),
      bundling: {
        nodeModules: ['@databases/pg'],
      },
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DB_SECRET_ARN: this.instance.secret!.secretArn,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:PutSecretValue',
          ],
          resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${cdk.Aws.STACK_NAME}-${id}-*`],
        }),
        new iam.PolicyStatement({
          notActions: [
            'secretsmanager:PutSecretValue',
          ],
          resources: [this.instance.secret!.secretArn],
        }),
      ],
      vpc,
    });

    // Allow a function to connect to database
    userPasswordFunction.connections.allowToDefaultPort(this.instance);

    this.userPasswordProvider = new cr.Provider(this, 'UserPasswordProvider', { onEventHandler: userPasswordFunction });
  }

  /** Generate and set password to database user */
  genUserPassword(username: string) {
    /** Scope */
    const user = new Construct(this, username);

    /** User secret */
    const secret = new secretsmanager.Secret(user, 'Secret', {
      secretName: `${cdk.Aws.STACK_NAME}-${this.node.id}-${username}`,
      description: `Supabase - Database User ${username}`,
      generateSecretString: {
        excludePunctuation: true,
        secretStringTemplate: JSON.stringify({ username }),
        generateStringKey: 'password',
      },
    });

    /** Modify password job */
    const password = new cdk.CustomResource(user, 'Resource', {
      serviceToken: this.userPasswordProvider.serviceToken,
      resourceType: 'Custom::DatabaseUserPassword',
      properties: {
        Username: username,
        SecretId: secret.secretArn,
      },
    });

    // Wait until the database migration is complete.
    secret.node.addDependency(this.migration.node.defaultChild!);
    password.node.addDependency(this.migration.node.defaultChild!);

    return secret;
  }

}
