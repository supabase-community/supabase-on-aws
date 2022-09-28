import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
//import { Secret, CfnSecret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface OrganizationProps {
  region: string;
}

export class Organization extends Construct {
  resource: cdk.CfnResource;
  region: string;
  alias: string;
  domain: string;
  organizationId: string;
  //createUserProvider: cr.Provider;

  constructor(scope: Construct, id: string, props: OrganizationProps) {
    super(scope, id);

    this.region = props.region;
    this.alias = `supabase-${cdk.Aws.ACCOUNT_ID}`;
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

    //const checkOrgFunction = new NodejsFunction(this, 'CheckOrgFunction', {
    //  description: 'Supabase - Check state WorkMail Org Function',
    //  entry: './src/functions/check-workmail-org.ts',
    //  runtime: lambda.Runtime.NODEJS_16_X,
    //  initialPolicy: [
    //    new iam.PolicyStatement({
    //      actions: [
    //        'workmail:DescribeOrganization',
    //        'ses:GetIdentityVerificationAttributes',
    //      ],
    //      resources: ['*'],
    //    }),
    //  ],
    //});

    const createOrgProvider = new cr.Provider(this, 'CreateOrgProvider', {
      onEventHandler: createOrgFunction,
      //isCompleteHandler: checkOrgFunction,
    });

    this.resource = new cdk.CfnResource(this, 'Resource', {
      type: 'Custom::WorkMailOrganization',
      properties: {
        ServiceToken: createOrgProvider.serviceToken,
        Region: this.region,
        Alias: this.alias,
      },
    });
    this.organizationId = this.resource.ref;

    //const createUserFunction = new NodejsFunction(this, 'CreateUserFunction', {
    //  description: 'Supabase - Create WorkMail User Function',
    //  entry: './src/functions/create-workmail-user.ts',
    //  runtime: lambda.Runtime.NODEJS_16_X,
    //  initialPolicy: [
    //    new iam.PolicyStatement({
    //      actions: [
    //        'workmail:CreateUser',
    //        'workmail:DeleteUser',
    //        'workmail:RegisterToWorkMail',
    //        'workmail:DeregisterFromWorkMail',
    //        'ses:GetIdentityVerificationAttributes',
    //      ],
    //      resources: ['*'],
    //    }),
    //  ],
    //});

    //this.createUserProvider = new cr.Provider(this, 'CreateUserProvider', {
    //  onEventHandler: createUserFunction,
    //});
  }

  //addUser(name: string) {
  //  const secret = new Secret(this, `User-${name}-Secret`, {
  //    description: `Supabase - WorkMail User Secret - ${name}`,
  //    generateSecretString: {
  //      secretStringTemplate: JSON.stringify({
  //        username: name,
  //        email: `${name}@${this.domain}`,
  //      }),
  //      generateStringKey: 'password',
  //      passwordLength: 64,
  //    },
  //  });
  //  const user = new cdk.CfnResource(this, `User$-${name}`, {
  //    type: 'Custom::WorkMailUser',
  //    properties: {
  //      ServiceToken: this.createUserProvider.serviceToken,
  //      Region: this.region,
  //      OrganizationId: this.organizationId,
  //      SecretId: secret.secretArn,
  //    },
  //  });
  //  user.addOverride('Condition', this.condition.logicalId);
  //  return secret;
  //}
}
