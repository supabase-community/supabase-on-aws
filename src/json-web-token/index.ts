import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret, SecretProps } from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export class JwtSecret extends Secret {
  /** Custom resource provider to generate a json web token */
  genTokenProvider: cr.Provider;

  /** Creates a new jwt secret in AWS SecretsManager. */
  constructor(scope: Construct, id: string, props?: SecretProps) {
    super(scope, id, {
      description: `${cdk.Aws.STACK_NAME} - Json Web Token Secret`,
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
      ...props,
    });

    /** Custom resource handler to generate a json web token */
    const jwtFunction = new NodejsFunction(this, 'JsonWebTokenFunction', {
      description: `${cdk.Aws.STACK_NAME} - Generate token via jwt secret`,
      entry: path.resolve(__dirname, 'cr-json-web-token.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        JWT_SECRET_ARN: this.secretArn,
      },
    });

    /** Allow the function to read the jwt secret */
    this.grantRead(jwtFunction);

    this.genTokenProvider = new cr.Provider(this, 'GenerateTokenProvider', { onEventHandler: jwtFunction });
  }

  /** Generate a new token in ParameterStore. */
  genApiKey(id: string, props: ApiKeyProps) {
    const apiKey = new ApiKey(this, id, props);
    return apiKey;
  }
}

interface ApiKeyProps {
  roleName: string;
  issuer?: string;
  expiresIn?: string;
}

class ApiKey extends Construct {
  /** Token value */
  value: string;
  /** ParameterStore of the token */
  ssmParameter: ssm.StringParameter;

  /** Json Web Token */
  constructor(scope: JwtSecret, id: string, props: ApiKeyProps) {
    super(scope, id);

    const jwtSecret = scope;
    const roleName = props.roleName;
    const issuer = props.issuer;
    const expiresIn = props.expiresIn;

    /** String value of Json Web Token */
    const token = new cdk.CustomResource(this, 'Resource', {
      serviceToken: jwtSecret.genTokenProvider.serviceToken,
      resourceType: 'Custom::JsonWebToken',
      properties: {
        Payload: { role: roleName },
        Issuer: issuer,
        ExpiresIn: expiresIn,
      },
    });

    this.value = token.getAttString('Value');

    this.ssmParameter = new ssm.StringParameter(this, 'Parameter', {
      description: `${cdk.Aws.STACK_NAME} - Json Web Token, role: ${roleName}`,
      parameterName: `/${cdk.Aws.STACK_NAME}/${jwtSecret.node.id}/${id}`,
      stringValue: this.value,
      simpleName: false,
    });

  }
}
