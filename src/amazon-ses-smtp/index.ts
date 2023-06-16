import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { WorkMailStack } from '../aws-workmail';

interface SesSmtpProps {
  region: string;
  email: string;
  workMailEnabled: cdk.CfnCondition;
}

export class SesSmtp extends Construct {
  secret: Secret;
  host: string;
  port: number;
  email: string;

  constructor(scope: Construct, id: string, props: SesSmtpProps) {
    super(scope, id);

    const { region, email, workMailEnabled } = props;

    /** IAM Policy to send email via Amazon SES */
    const sendEmailPolicy = new iam.Policy(this, 'SendEmailPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['ses:SendRawEmail'],
          resources: ['*'],
        }),
      ],
    });

    /** IAM User to send email via Amazon SES */
    const user = new iam.User(this, 'User');
    user.attachInlinePolicy(sendEmailPolicy);

    /** SMTP username */
    const accessKey = new iam.CfnAccessKey(this, 'AccessKey', { userName: user.userName });

    /** Custom resource handler to generate a SMTP password */
    const passwordFunction = new NodejsFunction(this, 'PasswordFunction', {
      description: 'Supabase - Generate SMTP Password Function',
      entry: path.resolve(__dirname, 'cr-smtp-password.ts'),
      runtime: lambda.Runtime.NODEJS_18_X,
    });

    /** Custom resource provider to generate a SMTP password */
    const passwordProvider = new cr.Provider(this, 'PasswordProvider', { onEventHandler: passwordFunction });

    /** SMTP password */
    const password = new cdk.CustomResource(this, 'Password', {
      resourceType: 'Custom::Password',
      serviceToken: passwordProvider.serviceToken,
      properties: {
        Region: region,
        SecretAccessKey: accessKey.attrSecretAccessKey,
      },
    });

    const stackId = cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID));

    /** Amazon WorkMail Stack */
    const workMail = new WorkMailStack(this, 'WorkMail', {
      description: 'Amazon WorkMail for Test Domain',
      organization: { region: region, alias: stackId },
    });

    /** The mail user on WorkMail */
    const workMailUser = workMail.organization.addUser('Supabase', password.getAttString('Password'));
    (workMail.node.defaultChild as cdk.CfnStack).cfnOptions.condition = workMailEnabled;

    this.host = cdk.Fn.conditionIf(workMailEnabled.logicalId, `smtp.mail.${region}.awsapps.com`, `email-smtp.${region}.amazonaws.com`).toString();
    this.port = 465;
    this.email = cdk.Fn.conditionIf(workMailEnabled.logicalId, workMailUser.getAtt('Email'), email).toString();
    const username = cdk.Fn.conditionIf(workMailEnabled.logicalId, workMailUser.getAtt('Email'), accessKey.ref).toString();

    this.secret = new Secret(this, 'Secret', {
      secretName: `${cdk.Aws.STACK_NAME}${id}Secret`,
      description: 'Supabase - SMTP Secret',
      secretObjectValue: {
        username: cdk.SecretValue.unsafePlainText(username),
        password: cdk.SecretValue.resourceAttribute(password.getAttString('Password')),
        host: cdk.SecretValue.unsafePlainText(this.host),
      },
    });

  }
}
