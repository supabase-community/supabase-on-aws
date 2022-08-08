import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseDatabaseProps {
  vpc: ec2.IVpc;
  mesh?: appmesh.IMesh;
}

export class SupabaseDatabase extends rds.DatabaseCluster {
  virtualService?: appmesh.VirtualService;
  virtualNode?: appmesh.VirtualNode;
  constructor(scope: Construct, id: string, props: SupabaseDatabaseProps) {

    const { vpc, mesh } = props;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.of('14.3', '14'),
    });

    const parameterGroup = new rds.ParameterGroup(scope, 'ParameterGroup', {
      engine,
      description: `Supabase parameter group for aurora-postgresql ${engine.engineVersion?.majorVersion}`,
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

    super(scope, id, {
      engine,
      parameterGroup,
      storageEncrypted: true,
      instances: 1,
      instanceProps: {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
        vpc,
      },
      credentials: rds.Credentials.fromGeneratedSecret('supabase_admin'),
      defaultDatabaseName: 'postgres',
    });

    const urlGeneratorFunction = new NodejsFunction(this, 'UrlGeneratorFunction', {
      description: 'Supabase - Database URL generator function',
      entry: './src/functions/db-url-generate.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
    });
    this.secret?.grantWrite(urlGeneratorFunction);
    this.secret?.grantRead(urlGeneratorFunction);

    const urlProvider = new cr.Provider(this, 'UrlProvider', { onEventHandler: urlGeneratorFunction });

    new cdk.CustomResource(this, 'URL', {
      serviceToken: urlProvider.serviceToken,
      resourceType: 'Custom::SupabaseDatabaseUrl',
      properties: {
        SecretId: this.secret?.secretArn,
        Hostname: this.clusterEndpoint.hostname,
      },
    });

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

    this.connections.allowDefaultPortFrom(initFunction);
    this.secret?.grantRead(initFunction);

    const initProvider = new cr.Provider(this, 'InitProvider', { onEventHandler: initFunction });

    const init = new cdk.CustomResource(this, 'Init', {
      serviceToken: initProvider.serviceToken,
      resourceType: 'Custom::SupabaseDatabaseInit',
      properties: {
        SecretId: this.secret?.secretArn,
        Hostname: this.clusterEndpoint.hostname,
      },
    });
    init.node.addDependency(this.node.findChild('Instance1'));

    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        serviceDiscovery: appmesh.ServiceDiscovery.dns(this.clusterEndpoint.hostname, appmesh.DnsResponseType.ENDPOINTS),
        listeners: [appmesh.VirtualNodeListener.tcp({ port: this.clusterEndpoint.port })],
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: this.clusterEndpoint.hostname,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });
    }

    // test
    //const testEngine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_14_2 });
    //const testParameterGroup = new rds.ParameterGroup(this, 'TestParameterGroup', {
    //  engine: testEngine,
    //  parameters: {
    //    'rds.logical_replication': '1',
    //    'max_logical_replication_workers': '2',
    //    'max_slot_wal_keep_size': '1024',
    //  },
    //});
    //const testInstance = new rds.DatabaseInstance(this, 'TestInstance2', {
    //  engine: testEngine,
    //  parameterGroup: testParameterGroup,
    //  securityGroups: this.securityGroups,
    //  credentials: rds.Credentials.fromGeneratedSecret('supabase_admin'),
    //  databaseName: 'postgres',
    //  vpc,
    //});
    //testInstance.secret?.grantWrite(urlGeneratorFunction);
    //testInstance.secret?.grantRead(urlGeneratorFunction);
    //new cdk.CustomResource(this, 'TestUrl', {
    //  serviceToken: urlProvider.serviceToken,
    //  resourceType: 'Custom::SupabaseDatabaseUrl',
    //  properties: {
    //    SecretId: testInstance.secret?.secretArn,
    //    Hostname: testInstance.dbInstanceEndpointAddress,
    //  },
    //});
    //testInstance.secret?.grantRead(initFunction);
    //new cdk.CustomResource(this, 'TestInit', {
    //  serviceToken: initProvider.serviceToken,
    //  resourceType: 'Custom::SupabaseDatabaseInit',
    //  properties: {
    //    SecretId: testInstance.secret?.secretArn,
    //    Hostname: testInstance.dbInstanceEndpointAddress,
    //  },
    //});
    //this.secret = testInstance.secret;

  }
}
