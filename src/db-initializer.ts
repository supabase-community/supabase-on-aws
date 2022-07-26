import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface DatabaseInitializerProps {
  db: rds.DatabaseCluster;
}

export class DatabaseInitializer extends Construct {

  constructor(scope: Construct, id: string, props: DatabaseInitializerProps) {
    super(scope, id);

    const { vpc, secret } = props.db;

    const initFunction = new lambda.DockerImageFunction(this, 'Function', {
      code: lambda.DockerImageCode.fromImageAsset('./src/containers/db-init'),
      timeout: cdk.Duration.seconds(60),
      vpc,
    });
    secret?.grantRead(initFunction);

    const provider = new cr.Provider(this, 'Provider', { onEventHandler: initFunction });

    //new cdk.CustomResource(this, 'Exec', {
    //  serviceToken: provider.serviceToken,
    //  resourceType: 'Custom::SupabaseDatabaseInit',
    //  properties: {
    //    SecretId: secret?.secretArn,
    //  },
    //});

  }
}
