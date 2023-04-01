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

const excludeCharacters = '%+~`#$&*()|[]{}:;<>?!\'/@\"\\=^'; // for Password

interface SupabaseDatabaseProps {
  vpc: ec2.IVpc;
}

export class SupabaseDatabase extends Construct {
  cluster: rds.DatabaseCluster;
  secret: secretsmanager.ISecret;
  //secretRotationSucceeded: events.Rule;
  url: {
    writer: ssm.StringParameter;
    writerAuth: ssm.StringParameter;
    reader: ssm.StringParameter;
  };
  cfnParameters: {
    minCapacity: cdk.CfnParameter;
    maxCapacity: cdk.CfnParameter;
    instanceClass: cdk.CfnParameter;
    instanceCount: cdk.CfnParameter;
  };

  /** PosthreSQL cluster with aurora-postgresql engine */
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
      version: rds.AuroraPostgresEngineVersion.VER_14_5,
    });

    const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
      engine,
      description: 'Supabase parameter group for aurora-postgresql',
      parameters: {
        'shared_preload_libraries': 'pg_stat_statements, pgaudit, pg_cron',
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
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin', { excludeCharacters }),
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

    this.secret = this.cluster.secret!;

    // Sync to SSM Parameter Store for database_url
    const username = this.secret.secretValueFromJson('username').toString();
    const password = this.secret.secretValueFromJson('password').toString();
    const dbname = this.secret.secretValueFromJson('dbname').toString();

    this.url = {
      writer: new ssm.StringParameter(this, 'WriterUrlParameter', {
        parameterName: `/${cdk.Aws.STACK_NAME}/${id}/Url/Writer`,
        description: 'The standard connection PostgreSQL URI format.',
        stringValue: `postgres://${username}:${password}@${this.cluster.clusterEndpoint.hostname}:${this.cluster.clusterEndpoint.port}/${dbname}`,
        simpleName: false,
      }),
      writerAuth: new ssm.StringParameter(this, 'WriterAuthUrlParameter', {
        parameterName: `/${cdk.Aws.STACK_NAME}/${id}/Url/Writer/auth`,
        description: 'The standard connection PostgreSQL URI with search_path=auth',
        stringValue: `postgres://${username}:${password}@${this.cluster.clusterEndpoint.hostname}:${this.cluster.clusterEndpoint.port}/${dbname}?search_path=auth`,
        simpleName: false,
      }),
      reader: new ssm.StringParameter(this, 'ReaderUrlParameter', {
        parameterName: `/${cdk.Aws.STACK_NAME}/${id}/Url/Reader`,
        description: 'The standard connection PostgreSQL URI format.',
        stringValue: `postgres://${username}:${password}@${this.cluster.clusterReadEndpoint.hostname}:${this.cluster.clusterReadEndpoint.port}/${dbname}`,
        simpleName: false,
      }),
    };

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

    /** Custom resource function for database initialization */
    const initFunction = new NodejsFunction(this, 'InitFunction', {
      description: 'Supabase - Database init function',
      entry: path.resolve(__dirname, 'functions/db-init/index.ts'),
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
            return [`cp ${inputDir}/src/functions/db-init/*.sql ${outputDir}`];
          },
        },
      },
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(60),
      vpc,
    });

    this.cluster.connections.allowDefaultPortFrom(initFunction);
    this.secret.grantRead(initFunction);

    /** Custom resource provider for database initialization */
    const initProvider = new cr.Provider(this, 'InitProvider', { onEventHandler: initFunction });

    /** Modify schema and initial data */
    const init = new cdk.CustomResource(this, 'InitData', {
      serviceToken: initProvider.serviceToken,
      resourceType: 'Custom::SupabaseInitData',
      properties: {
        SecretId: this.secret.secretArn,
        Hostname: this.cluster.clusterEndpoint.hostname,
        Fingerprint: cdk.FileSystem.fingerprint('./src/functions/db-init'),
      },
    });
    init.node.addDependency(this.cluster.node.findChild('Instance1'));

  }
}
