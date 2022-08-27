import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseJwtProps {
  issuer?: string;
  expiresIn?: string;
}

export class SupabaseJwt extends Construct {
  secret: Secret;
  serviceRoleKey: ssm.StringParameter;
  anonKey: ssm.StringParameter;
  anonToken: string;

  constructor(scope: Construct, id: string, props: SupabaseJwtProps = {}) {
    super(scope, id);

    const { issuer, expiresIn } = props;

    this.secret = new Secret(this, 'Secret', {
      description: 'Supabase - Json Web Token Secret',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const createApiRoleFunction = new NodejsFunction(this, 'CreateApiRoleFunction', {
      description: 'Supabase - Create API role & API key',
      entry: './src/functions/gen-json-web-token.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: { JWT_SECRET_ARN: this.secret.secretArn },
    });
    this.secret.grantRead(createApiRoleFunction);

    const provider = new cr.Provider(this, 'Provider', { onEventHandler: createApiRoleFunction });

    const anon = new cdk.CustomResource(this, 'AnonRole', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::SupabaseApiRole',
      properties: {
        Payload: { role: 'anon' },
        Issuer: issuer,
        ExpiresIn: expiresIn,
      },
    });
    this.anonToken = anon.getAttString('Token');

    const serviceRole = new cdk.CustomResource(this, 'ServiceRole', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::SupabaseApiRole',
      properties: {
        Payload: { role: 'service_role' },
        Issuer: issuer,
        ExpiresIn: expiresIn,
      },
    });

    this.anonKey = new ssm.StringParameter(this, 'AnonKey', {
      parameterName: `/${cdk.Aws.STACK_NAME}/JWT/anon`,
      description: 'This key is safe to use in a browser if you have enabled Row Level Security for your tables and configured policies.',
      stringValue: anon.getAttString('Token'),
      simpleName: false,
    });

    this.serviceRoleKey = new ssm.StringParameter(this, 'ServiceRoleKey', {
      parameterName: `/${cdk.Aws.STACK_NAME}/JWT/service_role`,
      description: 'This key has the ability to bypass Row Level Security. Never share it publicly.',
      stringValue: serviceRole.getAttString('Token'),
      simpleName: false,
    });

  }
}
