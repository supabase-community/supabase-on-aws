import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';


interface StackProps extends cdk.NestedStackProps {
  organization: OrganizationProps;
}

export class WorkMailStack extends cdk.NestedStack {
  organization: Organization;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.organization = new Organization(this, 'Organization', props.organization);
  }
}

interface OrganizationProps {
  region: string;
  alias: string;
}

export class Organization extends Construct {
  region: string;
  alias: string;
  domain: string;
  organizationId: string;
  createUserProvider: cr.Provider;

  constructor(scope: Construct, id: string, props: OrganizationProps) {
    super(scope, id);

    this.region = props.region;
    this.alias = props.alias;
    this.domain = `${this.alias}.awsapps.com`;

    const createOrgFunction = new NodejsFunction(this, 'CreateOrgFunction', {
      description: 'Supabase - Create WorkMail Org Function',
      entry: './src/functions/create-workmail-org.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(10),
      initialPolicy: [
        new iam.PolicyStatement({
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
        }),
      ],
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

    const org = new cdk.CfnResource(this, 'Resource', {
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
      timeout: cdk.Duration.seconds(10),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            'workmail:DescribeOrganization',
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

  addUser(username: string, password: string) {
    const user = new cdk.CfnResource(this, username, {
      type: 'Custom::WorkMailUser',
      properties: {
        ServiceToken: this.createUserProvider.serviceToken,
        Region: this.region,
        OrganizationId: this.organizationId,
        Username: username,
        Password: password,
      },
    });
    return user;
  }
}
