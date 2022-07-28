import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export class SupabaseJwtSecret extends Secret {

  constructor(scope: Construct, id: string) {
    super(scope, id, {
      description: 'Supabase - Json Web Token Secret',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ jwt_secret: 'your-super-secret-jwt-token-with-at-least-32-characters-long' }),
        generateStringKey: 'jwt_secret',
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const generatorFunction = new NodejsFunction(this, 'GeneratorFunction', {
      description: 'Supabase - JWT Generator',
      entry: './src/functions/jwt-generate.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
    });
    this.grantWrite(generatorFunction);
    this.grantRead(generatorFunction);

    const provider = new cr.Provider(this, 'Provider', { onEventHandler: generatorFunction });

    new cdk.CustomResource(this, 'JWT', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::SupabaseJWT',
      properties: {
        SecretId: this.secretArn,
      },
    });

  }
}
