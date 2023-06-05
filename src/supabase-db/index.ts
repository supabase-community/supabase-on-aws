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
}

export class SupabaseDatabase extends Construct {
  cluster: rds.DatabaseCluster;
  cfnParameters: {
    minCapacity: cdk.CfnParameter;
    maxCapacity: cdk.CfnParameter;
    instanceClass: cdk.CfnParameter;
    instanceCount: cdk.CfnParameter;
  };
  /** Database migration */
  migration: cdk.CustomResource;
  /** Custom resource provider to generate user password */
  userPasswordProvider: cr.Provider;

  /** Database with Roles managed by Supabase */
  constructor(scope: Construct, id: string, props: SupabaseDatabaseProps) {
    super(scope, id);

    const { vpc } = props;

    this.cfnParameters = {
      instanceClass: new cdk.CfnParameter(this, 'InstanceClass', {
        type: 'String',
        default: 'db.serverless',
        allowedValues: ['db.serverless', 'db.t4g.medium', 'db.t4g.large', 'db.r6g.large', 'db.r6g.xlarge', 'db.r6g.2xlarge', 'db.r6g.4xlarge', 'db.r6g.8xlarge', 'db.r6g.12xlarge', 'db.r6g.16xlarge'],
      }),
      instanceCount: new cdk.CfnParameter(this, 'InstanceCount', {
        type: 'Number',
        default: 1,
        minValue: 1,
        maxValue: 16,
      }),
      minCapacity: new cdk.CfnParameter(this, 'MinCapacity', {
        description: 'The minimum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.',
        type: 'Number',
        default: 0.5,
        minValue: 0.5,
        maxValue: 128,
      }),
      maxCapacity: new cdk.CfnParameter(this, 'MaxCapacity', {
        description: 'The maximum number of Aurora capacity units (ACUs) for a DB instance in an Aurora Serverless v2 cluster.',
        type: 'Number',
        default: 32,
        minValue: 0.5,
        maxValue: 128,
      }),
    };

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_15_2,
    });

    const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
      engine,
      description: 'Supabase parameter group for aurora-postgresql',
      parameters: {
        'shared_preload_libraries': 'pg_tle, pg_stat_statements, pgaudit, pg_cron',
        // Logical Replication - https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Replication.Logical.html
        'rds.logical_replication': '1',
        'max_replication_slots': '20', // Default Aurora:20, Supabase:5
        'max_wal_senders': '20', // Default Aurora:20, Supabase:10
        'max_logical_replication_workers': '4',
        'autovacuum_max_workers': 'GREATEST({DBInstanceClassMemory/64371566592},2)', // Default: GREATEST({DBInstanceClassMemory/64371566592},3)
        'max_parallel_workers': '2', // Default: GREATEST(${DBInstanceVCPU/2},8)
        //'max_worker_processes': '', // Default: GREATEST(${DBInstanceVCPU*2},8)

        'max_slot_wal_keep_size': '1024', // https://github.com/supabase/realtime
      },
    });

    this.cluster = new rds.DatabaseCluster(this, 'Cluster', {
      engine,
      parameterGroup,
      storageEncrypted: true,
      instances: 16,
      instanceProps: {
        instanceType: new ec2.InstanceType('serverless'),
        enablePerformanceInsights: true,
        vpc,
      },
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin', {
        secretName: `${cdk.Aws.STACK_NAME}-${id}-supabase_admin`,
      }),
      defaultDatabaseName: 'postgres',
    });

    (this.cluster.node.defaultChild as rds.CfnDBCluster).serverlessV2ScalingConfiguration = {
      minCapacity: this.cfnParameters.minCapacity.valueAsNumber,
      maxCapacity: this.cfnParameters.maxCapacity.valueAsNumber,
    };

    // Replace instance class in the DB cluster
    const updateDBInstance = (index: number, parentCondition?: cdk.CfnCondition) => {
      const expression = (typeof parentCondition == 'undefined')
        ? cdk.Fn.conditionEquals(this.cfnParameters.instanceCount, index)
        : cdk.Fn.conditionOr(parentCondition, cdk.Fn.conditionEquals(this.cfnParameters.instanceCount, index));
      const condition = new cdk.CfnCondition(this, `Instance${index}Enabled`, { expression });
      const dbInstance = this.cluster.node.findChild(`Instance${index}`) as rds.CfnDBInstance;
      dbInstance.cfnOptions.condition = condition;
      dbInstance.dbInstanceClass = this.cfnParameters.instanceClass.valueAsString;
      if (index >= 2) {
        updateDBInstance(index-1, condition);
      }
    };
    updateDBInstance(16);

    //const syncSecretFunction = new NodejsFunction(this, 'SyncSecretFunction', {
    //  description: 'Supabase - Sync DB secret to parameter store',
    //  entry: 'src/functions/db-secret-sync.ts',
    //  runtime: lambda.Runtime.NODEJS_18_X,
    //  architecture: lambda.Architecture.ARM_64,
    //  environment: {
    //    WRITER_PARAMETER_NAME: this.url.writer.parameterName,
    //    READER_PARAMETER_NAME: this.url.reader.parameterName,
    //  },
    //  initialPolicy: [
    //    new iam.PolicyStatement({
    //      sid: 'PutParameter',
    //      actions: [
    //        'ssm:PutParameter',
    //        'ssm:GetParametersByPath',
    //        'ssm:GetParameters',
    //        'ssm:GetParameter',
    //      ],
    //      resources: [
    //        this.url.writer.parameterArn,
    //        this.url.writer.parameterArn + '/*',
    //        this.url.reader.parameterArn,
    //        this.url.reader.parameterArn + '/*',
    //      ],
    //    }),
    //  ],
    //});
    //this.secret.grantRead(syncSecretFunction);

    //this.secretRotationSucceeded = new events.Rule(this, 'SecretRotationSucceeded', {
    //  description: `Supabase - ${id} secret rotation succeeded`,
    //  eventPattern: {
    //    source: ['aws.secretsmanager'],
    //    detailType: ['AWS Service Event via CloudTrail'],
    //    detail: {
    //      eventName: ['RotationSucceeded'],
    //      additionalEventData: {
    //        SecretId: [this.secret.secretArn],
    //      },
    //    },
    //  },
    //  targets: [new targets.LambdaFunction(syncSecretFunction)],
    //});

    // Password rotation
    //const rotationSecurityGroup = new ec2.SecurityGroup(this, 'RotationSecurityGroup', { vpc });
    //this.secret.addRotationSchedule('Rotation', {
    //  automaticallyAfter: cdk.Duration.days(30),
    //  hostedRotation: secretsmanager.HostedRotation.postgreSqlSingleUser({
    //    functionName: `${this.secret.secretName}RotationFunction`,
    //    excludeCharacters,
    //    securityGroups: [rotationSecurityGroup],
    //    vpc,
    //  }),
    //});
    //this.cluster.connections.allowDefaultPortFrom(rotationSecurityGroup, 'Lambda to rotate secrets');

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
              `cp -rp ${inputDir}/src/supabase-db/sql/ ${outputDir}/`,
            ];
          },
        },
      },
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(60),
      environment: {
        DB_SECRET_ARN: this.cluster.secret!.secretArn
      },
      vpc,
    });

    // // Allow a function to connect to database
    this.cluster.connections.allowDefaultPortFrom(migrationFunction);

    // Allow a function to read db secret
    this.cluster.secret?.grantRead(migrationFunction);

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

    // Migrations waits until instance is ready
    this.migration.node.addDependency(this.cluster.node.findChild('Instance1'));

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
        DB_SECRET_ARN: this.cluster.secret!.secretArn
      },
      initialPolicy:[
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
          resources: [this.cluster.secret!.secretArn],
        }),
      ],
      vpc,
    });

    // Allow a function to connect to database
    this.cluster.connections.allowDefaultPortFrom(userPasswordFunction);

    this.userPasswordProvider = new cr.Provider(this, 'UserPasswordProvider', { onEventHandler: userPasswordFunction });
  }

  /** Generate and set password to database user */
  genUserPassword(username: string) {
    /** Scope */
    const user = new Construct(this, username);

    const secret = new secretsmanager.Secret(user, 'Secret', {
      secretName: `${cdk.Aws.STACK_NAME}-${this.node.id}-${username}`,
      description: `Supabase - Database User ${username}`,
      generateSecretString: {
        excludePunctuation: true,
        secretStringTemplate: JSON.stringify({ username }),
        generateStringKey: 'password',
      },
    })

    const resource = new cdk.CustomResource(user, 'Resource', {
      serviceToken: this.userPasswordProvider.serviceToken,
      resourceType: 'Custom::DatabaseUserPassword',
      properties: {
        Username: username,
        SecretId: secret.secretArn,
        stub: 'demo',
      },
    });

    // Wait for database migration
    resource.node.addDependency(this.migration.node.defaultChild!);

    return secret;
  }

}
