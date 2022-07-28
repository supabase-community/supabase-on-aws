import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseDatabaseProps {
  vpc: ec2.IVpc;
}

export class SupabaseDatabase extends rds.DatabaseCluster {
  constructor(scope: Construct, id: string, props: SupabaseDatabaseProps) {

    const vpc = props.vpc;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.of('14.3', '14'),
    });

    const parameterGroup = new rds.ParameterGroup(scope, 'ParameterGroup', {
      engine,
      description: 'Supabase parameter group for aurora-postgresql14',
      parameters: {
        'rds.logical_replication': '1',
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
      defaultDatabaseName: 'postgres',
    });

    const initFunction = new lambda.DockerImageFunction(this, 'InitFunction', {
      description: 'Supabase - Database init function',
      code: lambda.DockerImageCode.fromImageAsset('./src/containers/db-init'),
      timeout: cdk.Duration.seconds(60),
      vpc,
    });

    this.connections.allowDefaultPortFrom(initFunction);
    this.secret?.grantRead(initFunction);

    const initProvider = new cr.Provider(this, 'InitProvider', { onEventHandler: initFunction });

    new cdk.CustomResource(this, 'Init', {
      serviceToken: initProvider.serviceToken,
      resourceType: 'Custom::SupabaseDatabaseInit',
      properties: {
        SecretId: this.secret?.secretArn,
        Version: '7',
      },
    });

    const urlGeneratorFunction = new NodejsFunction(this, 'UrlGeneratorFunction', {
      description: 'Supabase - Database URL Generator',
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
      },
    });

  }
}
