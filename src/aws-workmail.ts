import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface WorkMailStackProps {
  region: string;
  alias: string;
}

export class WorkMailStack extends cdk.NestedStack {
  region: string;
  alias: string;
  domain: string;
  organizationId: string;
  createUserProvider: cr.Provider;

  constructor(scope: cdk.Stack, id: string, props: WorkMailStackProps) {
    super(scope, id, { description: 'Amazon WorkMail for Test Domain' });

    this.region = props.region;
    this.alias = props.alias;
    this.domain = `${this.alias}.awsapps.com`;

    const createWorkMailOrgStatement = new iam.PolicyStatement({
      actions: [
        'workmail:DescribeOrganization',
        'workmail:CreateOrganization',
        'workmail:DeleteOrganization',
        'ses:DescribeActiveReceiptRuleSet',
        'ses:SetActiveReceiptRuleSet',
        'ses:CreateReceiptRuleSet',
        'ses:CreateReceiptRule',
        'ses:DeleteReceiptRule',
        'ses:VerifyDomainIdentity',
        'ses:VerifyDomainDkim',
        'ses:SetIdentityEmailNotificationEnabled',
        'ses:PutIdentityPolicy',
        'ses:DeleteIdentityPolicy',
        'ses:DeleteIdentity',
        'ds:DescribeDirectories',
        'ds:CreateIdentityPoolDirectory',
        'ds:DeleteDirectory',
        'ds:ListAuthorizedApplications',
        'ds:CreateAlias',
        'ds:AuthorizeApplication',
        'ds:UnauthorizeApplication',
      ],
      resources: ['*'],
    });

    const createOrgFunction = new NodejsFunction(this, 'CreateOrgFunction', {
      description: 'Supabase - Create WorkMail Org Function',
      entry: './src/functions/create-workmail-org.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      initialPolicy: [createWorkMailOrgStatement],
    });

    const checkOrgFunction = new NodejsFunction(this, 'CheckOrgFunction', {
      description: 'Supabase - Check state WorkMail Org Function',
      entry: './src/functions/check-workmail-org.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            'workmail:DescribeOrganization',
            'ses:GetIdentityVerificationAttributes',
          ],
          resources: ['*'],
        }),
      ],
    });

    const createOrgProvider = new cr.Provider(this, 'CreateOrgProvider', {
      onEventHandler: createOrgFunction,
      isCompleteHandler: checkOrgFunction,
    });

    const org = new cdk.CfnResource(this, 'Organization', {
      type: 'Custom::WorkMailOrganization',
      properties: {
        ServiceToken: createOrgProvider.serviceToken,
        Region: this.region,
        Alias: this.alias,
      },
    });
    this.organizationId = org.ref;

    const createUserFunction = new NodejsFunction(this, 'CreateUserFunction', {
      description: 'Supabase - Create WorkMail User Function',
      entry: './src/functions/create-workmail-user.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            'workmail:CreateUser',
            'workmail:DeleteUser',
            'workmail:RegisterToWorkMail',
            'workmail:DeregisterFromWorkMail',
            'ses:GetIdentityVerificationAttributes',
          ],
          resources: ['*'],
        }),
      ],
    });

    this.createUserProvider = new cr.Provider(this, 'CreateUserProvider', {
      onEventHandler: createUserFunction,
    });
  }

  addUser(name: string) {
    const secret = new Secret(this, `User-${name}-Secret`, {
      description: `Supabase - WorkMail User Secret - ${name}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: name }),
        generateStringKey: 'password',
        passwordLength: 64,
      },
    });
    secret.grantRead(this.createUserProvider.onEventHandler);

    new cdk.CfnResource(this, `User$-${name}`, {
      type: 'Custom::WorkMailUser',
      properties: {
        ServiceToken: this.createUserProvider.serviceToken,
        Region: this.region,
        OrganizationId: this.organizationId,
        SecretId: secret.secretArn,
      },
    });

    return secret;
  }
}
