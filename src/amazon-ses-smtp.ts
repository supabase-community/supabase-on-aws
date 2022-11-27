import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { WorkMailStack } from './aws-workmail';

export class Smtp extends Construct {
  params: {
    region: cdk.CfnParameter;
    email: cdk.CfnParameter;
    enableTestDomain: cdk.CfnParameter;
  }
  secret: Secret;
  host: string;
  port: number;
  email: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.params = {
      region: new cdk.CfnParameter(this, 'Region', {
        description: 'Amazon SES used for SMTP server. If you want to use Amazon WorkMail, need to set us-east-1, us-west-2 or eu-west-1.',
        type: 'String',
        default: 'us-west-2',
        allowedValues: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'sa-east-1'],
      }),
      email: new cdk.CfnParameter(this, 'Email', {
        description: 'This is the email address the emails are sent from. If Amazon WorkMail is enabled, it set "noreply@supabase-<account_id>.awsapps.com"',
        type: 'String',
        default: 'noreply@example.com',
        allowedPattern: '^[\\x20-\\x45]?[\\w-\\+]+(\\.[\\w]+)*@[\\w-]+(\\.[\\w]+)*(\\.[a-z]{2,})$',
        constraintDescription: 'must be a valid email address',
      }),
      enableTestDomain: new cdk.CfnParameter(this, 'EnableTestDomain', {
        description: 'Enable test e-mail domain "xxx.awsapps.com" with Amazon WorkMail.',
        type: 'String',
        default: 'false',
        allowedValues: ['true', 'false'],
      }),
    };

    const region = this.params.region.valueAsString;
    const workMailEnabled = new cdk.CfnCondition(this, 'WorkMailEnabled', { expression: cdk.Fn.conditionEquals(this.params.enableTestDomain, 'true') });

    new cdk.CfnRule(this, 'CheckWorkMailRegion', {
      ruleCondition: workMailEnabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionContains(['us-east-1', 'us-west-2', 'eu-west-1'], region),
        assertDescription: 'Amazon WorkMail is supported only in us-east-1, us-west-2 or eu-west-1. Please change Amazon SES Region.',
      }],
    });

    const sendEmailPolicy = new iam.Policy(this, 'SendEmailPolicy', {
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

    const genPasswordFunction = new NodejsFunction(this, 'GenPasswordFunction', {
      description: 'Supabase - Generate SMTP Password Function',
      entry: './src/functions/gen-smtp-password.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
    });

    const genPasswordProvider = new cr.Provider(this, 'GenPasswordProvider', { onEventHandler: genPasswordFunction });

    const password = new cdk.CustomResource(this, 'Password', {
      resourceType: 'Custom::Password',
      serviceToken: genPasswordProvider.serviceToken,
      properties: {
        Region: region,
        SecretAccessKey: accessKey.attrSecretAccessKey,
      },
    });

    const stackId = cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID));

    const workMail = new WorkMailStack(this, 'WorkMail', {
      description: 'Amazon WorkMail for Test Domain',
      organization: { region: region, alias: stackId },
    });
    const workMailUser = workMail.organization.addUser('Supabase', password.getAttString('Password'));
    (workMail.node.defaultChild as cdk.CfnStack).cfnOptions.condition = workMailEnabled;

    this.host = cdk.Fn.conditionIf(workMailEnabled.logicalId, `smtp.mail.${region}.awsapps.com`, `email-smtp.${region}.amazonaws.com`).toString();
    this.port = 465;
    this.email = cdk.Fn.conditionIf(workMailEnabled.logicalId, workMailUser.getAtt('Email'), this.params.email.valueAsString).toString();
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
