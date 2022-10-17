import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

// Support for Aurora Serverless v2
enum ServerlessInstanceType { SERVERLESS = 'serverless' }
type CustomInstanceType = ServerlessInstanceType | ec2.InstanceType;
const CustomInstanceType = { ...ServerlessInstanceType, ...ec2.InstanceType };

const excludeCharacters = '%+~`#$&*()|[]{}:;<>?!\'/@\"\\=^'; // for Password

interface SupabaseDatabaseProps {
  vpc: ec2.IVpc;
  multiAzEnabled: cdk.CfnCondition;
  minCapacity: number;
  maxCapacity: number;
}

export class SupabaseDatabase extends Construct {
  cluster: rds.DatabaseCluster;
  secret: secretsmanager.ISecret;
  url: {
    writer: ssm.StringParameter;
    writerSearchPathAuth: ssm.StringParameter;
    reader: ssm.StringParameter;
  };

  constructor(scope: Construct, id: string, props: SupabaseDatabaseProps) {
    super(scope, id);

    const { vpc, multiAzEnabled, minCapacity, maxCapacity } = props;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.of('14.3', '14'),
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
      instances: 2,
      instanceProps: {
        instanceType: CustomInstanceType.SERVERLESS as unknown as ec2.InstanceType,
        enablePerformanceInsights: true,
        vpc,
      },
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin', { excludeCharacters }),
      defaultDatabaseName: 'postgres',
    });

    this.secret = this.cluster.secret!;
    (this.cluster.node.findChild('Instance2') as rds.CfnDBInstance).addOverride('Condition', multiAzEnabled.logicalId);

    // Support for Aurora Serverless v2 ---------------------------------------------------
    const serverlessV2ScalingConfiguration = {
      MinCapacity: minCapacity,
      MaxCapacity: maxCapacity,
    };
    const dbScalingConfigure = new cr.AwsCustomResource(this, 'DbScalingConfigure', {
      resourceType: 'Custom::AuroraServerlessV2ScalingConfiguration',
      onCreate: {
        service: 'RDS',
        action: 'modifyDBCluster',
        parameters: {
          DBClusterIdentifier: this.cluster.clusterIdentifier,
          ServerlessV2ScalingConfiguration: serverlessV2ScalingConfiguration,
        },
        physicalResourceId: cr.PhysicalResourceId.of(this.cluster.clusterIdentifier),
      },
      onUpdate: {
        service: 'RDS',
        action: 'modifyDBCluster',
        parameters: {
          DBClusterIdentifier: this.cluster.clusterIdentifier,
          ServerlessV2ScalingConfiguration: serverlessV2ScalingConfiguration,
        },
        physicalResourceId: cr.PhysicalResourceId.of(this.cluster.clusterIdentifier),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });
    this.cluster.node.children.filter(child => child.node.id.startsWith('Instance')).map(child => {
      child.node.addDependency(dbScalingConfigure);
    });
    // Support for Aurora Serverless v2 ---------------------------------------------------

    // Sync to SSM Parameter Store for database_url ---------------------------------------
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
      writerSearchPathAuth: new ssm.StringParameter(this, 'WriterSearchPathAuthUrlParameter', {
        parameterName: `/${cdk.Aws.STACK_NAME}/${id}/Url/WriterSearchPathAuth`,
        description: 'The standard connection PostgreSQL URI format',
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

    const syncSecretFunction = new NodejsFunction(this, 'SyncSecretFunction', {
      description: 'Supabase - Sync DB secret to parameter store',
      entry: 'src/functions/db-secret-sync.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      architecture: lambda.Architecture.ARM_64,
      environment: {
        WRITER_PARAMETER_NAME: this.url.writer.parameterName,
        WRITER_AUTH_PARAMETER_NAME: this.url.writerSearchPathAuth.parameterName,
        READER_PARAMETER_NAME: this.url.reader.parameterName,
      },
    });
    this.url.writer.grantWrite(syncSecretFunction);
    this.url.writerSearchPathAuth.grantWrite(syncSecretFunction);
    this.url.reader.grantWrite(syncSecretFunction);
    this.secret.grantRead(syncSecretFunction);

    new events.Rule(this, 'SecretChangeRule', {
      description: 'Supabase - Update parameter store, when DB secret rotated',
      eventPattern: {
        source: ['aws.secretsmanager'],
        detail: {
          eventName: ['RotationSucceeded'],
          additionalEventData: {
            SecretId: [this.secret.secretArn],
          },
        },
      },
      targets: [new targets.LambdaFunction(syncSecretFunction)],
    });
    // Sync to SSM Parameter Store for database_url ---------------------------------------

    const rotationSecurityGroup = new ec2.SecurityGroup(this, 'RotationSecurityGroup', { vpc });
    this.secret.addRotationSchedule('Rotation', {
      automaticallyAfter: cdk.Duration.days(30),
      hostedRotation: secretsmanager.HostedRotation.postgreSqlSingleUser({
        functionName: `${this.secret.secretName}RotationFunction`,
        excludeCharacters,
        securityGroups: [rotationSecurityGroup],
        vpc,
      }),
    });
    this.cluster.connections.allowDefaultPortFrom(rotationSecurityGroup, 'Lambda to rotate secrets');

    const initFunction = new NodejsFunction(this, 'InitFunction', {
      description: 'Supabase - Database init function',
      entry: './src/functions/db-init/index.ts',
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
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(60),
      vpc,
    });

    this.cluster.connections.allowDefaultPortFrom(initFunction);
    this.secret.grantRead(initFunction);

    const initProvider = new cr.Provider(this, 'InitProvider', { onEventHandler: initFunction });

    const init = new cdk.CustomResource(this, 'InitData', {
      serviceToken: initProvider.serviceToken,
      resourceType: 'Custom::SupabaseInitData',
      properties: {
        SecretId: this.secret.secretArn,
        Hostname: this.cluster.clusterEndpoint.hostname,
      },
    });
    init.node.addDependency(this.cluster.node.findChild('Instance1'));

  }
}
