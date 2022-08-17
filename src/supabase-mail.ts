import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

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

export class SupabaseMailBase extends Construct {
  secret!: Secret;
  virtualService?: appmesh.VirtualService;
  virtualNode?: appmesh.VirtualNode;

  constructor(scope: Construct, id: string) {
    super(scope, id);
  }
}

interface SupabaseMailProps {
  region: string;
  mesh?: appmesh.IMesh;
}

export class SupabaseMail extends SupabaseMailBase {

  constructor(scope: Construct, id: string, props: SupabaseMailProps) {
    super(scope, id);

    const { region, mesh } = props;

    const smtpEndpoint = `email-smtp.${region}.amazonaws.com`;

    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        virtualNodeName: 'SES',
        serviceDiscovery: appmesh.ServiceDiscovery.dns(smtpEndpoint, appmesh.DnsResponseType.ENDPOINTS),
        listeners: [appmesh.VirtualNodeListener.tcp({ port: 465 })],
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: smtpEndpoint,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });
    }

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

    this.secret = new Secret(this, 'Secret', {
      description: 'Supabase - SES SMTP Secret',
      secretObjectValue: {
        access_key: cdk.SecretValue.resourceAttribute(accessKey.ref),
        secret_access_key: cdk.SecretValue.resourceAttribute(accessKey.attrSecretAccessKey),
      },
    });

    const genSmtpPasswordFunction = new NodejsFunction(this, 'GenSmtpPasswordFunction', {
      description: 'Supabase - Generate SMTP Password Function',
      entry: './src/functions/gen-smtp-password.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
    });
    this.secret.grantWrite(genSmtpPasswordFunction);
    this.secret.grantRead(genSmtpPasswordFunction);

    const genSmtpPasswordProvider = new cr.Provider(this, 'GenSmtpPasswordProvider', { onEventHandler: genSmtpPasswordFunction });

    new cdk.CustomResource(this, 'SmtpPassword', {
      resourceType: 'Custom::SmtpPassword',
      serviceToken: genSmtpPasswordProvider.serviceToken,
      properties: {
        SecretId: this.secret.secretArn,
        Region: region,
      },
    });

  }
}

interface SupabaseWorkMailProps {
  region: string;
  alias?: string;
  domainName?: string;
  username?: string;
  mesh?: appmesh.IMesh;
}

export class SupabaseWorkMail extends SupabaseMailBase {

  constructor(scope: Construct, id: string, props: SupabaseWorkMailProps) {
    super(scope, id);

    const { region, domainName, mesh } = props;
    const alias = props.alias || `supabase-${cdk.Aws.ACCOUNT_ID}`;
    const username = props.username || 'info';
    const email = (typeof domainName == 'undefined') ? `${username}@${alias}.awsapps.com` : `${username}@${domainName}`;

    const smtpEndpoint = `smtp.mail.${region}.awsapps.com`;
    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        virtualNodeName: 'WorkMail',
        serviceDiscovery: appmesh.ServiceDiscovery.dns(smtpEndpoint, appmesh.DnsResponseType.ENDPOINTS),
        listeners: [appmesh.VirtualNodeListener.tcp({ port: 465 })],
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: smtpEndpoint,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });
    }

    this.secret = new Secret(this, 'Secret', {
      description: 'Supabase - WorkMail SMTP Secret',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          host: smtpEndpoint,
          port: '465',
          username: email,
          password: 'your-super-secret-smtp-password',
          email: email,
        }),
        generateStringKey: 'password',
        passwordLength: 64,
      },
    });

    const createWorkMailOrgFunction = new NodejsFunction(this, 'CreateWorkMailOrgFunction', {
      description: 'Supabase - Create WorkMail Org Function',
      entry: './src/functions/create-workmail-org.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      initialPolicy: [createWorkMailOrgStatement],
    });

    const checkWorkMailOrgFunction = new NodejsFunction(this, 'CheckWorkMailOrgFunction', {
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

    const createWorkMailOrgProvider = new cr.Provider(this, 'CreateWorkMailOrgProvider', {
      onEventHandler: createWorkMailOrgFunction,
      isCompleteHandler: checkWorkMailOrgFunction,
    });

    const organization = new cdk.CustomResource(this, 'Organization', {
      resourceType: 'Custom::WorkMailOrganization',
      serviceToken: createWorkMailOrgProvider.serviceToken,
      properties: {
        Region: region,
        Alias: alias,
        DomainName: domainName,
      },
    });

    const createWorkMailUserFunction = new NodejsFunction(this, 'CreateWorkMailUserFunction', {
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
    this.secret.grantRead(createWorkMailUserFunction);

    const createWorkMailUserProvider = new cr.Provider(this, 'CreateWorkMailUserProvider', {
      onEventHandler: createWorkMailUserFunction,
    });

    new cdk.CustomResource(this, 'User', {
      resourceType: 'Custom::WorkMailUser',
      serviceToken: createWorkMailUserProvider.serviceToken,
      properties: {
        Region: region,
        OrganizationId: organization.ref,
        SecretId: this.secret.secretArn,
      },
    });

  }
}
