import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseMailProps {
  region: string;
}

export class SupabaseMail extends Construct {
  secret: Secret;

  constructor(scope: Construct, id: string, props: SupabaseMailProps) {
    super(scope, id);

    const { region } = props;
    const smtpEndpoint = `email-smtp.${region}.amazonaws.com`;

    const sendEmailPolicy = new iam.Policy(this, 'Policy', {
      policyName: 'SendEmailPolicy',
      statements: [
        new iam.PolicyStatement({
          actions: ['ses:SendRawEmail'],
          resources: ['*'],
        }),
      ],
    });

    const user = new iam.User(this, 'User');
    user.attachInlinePolicy(sendEmailPolicy);

    const accessKey = new iam.CfnAccessKey(this, 'AccessKey', { userName: user.userName });

    const genSmtpPasswordFunction = new NodejsFunction(this, 'GenSmtpPasswordFunction', {
      description: 'Supabase - Generate SMTP Password Function',
      entry: './src/functions/gen-smtp-password.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
    });

    const genSmtpPasswordProvider = new cr.Provider(this, 'GenSmtpPasswordProvider', { onEventHandler: genSmtpPasswordFunction });

    const smtpPassword = new cdk.CustomResource(this, 'SmtpPassword', {
      resourceType: 'Custom::SmtpPassword',
      serviceToken: genSmtpPasswordProvider.serviceToken,
      properties: {
        Region: region,
        SecretAccessKey: accessKey.attrSecretAccessKey,
      },
    });

    this.secret = new Secret(this, 'Secret', {
      description: 'Supabase - SES SMTP Secret',
      secretObjectValue: {
        username: cdk.SecretValue.resourceAttribute(accessKey.ref),
        password: cdk.SecretValue.resourceAttribute(smtpPassword.getAttString('Password')),
        host: cdk.SecretValue.unsafePlainText(smtpEndpoint),
      },
    });

  }
}
