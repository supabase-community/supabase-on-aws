import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { SupabaseServiceBase } from './supabase-service';

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

interface SupabaseMailProps {
  region: string;
  mesh?: appmesh.IMesh;
}

export class SupabaseMail extends SupabaseServiceBase {
  secret: Secret;

  constructor(scope: Construct, id: string, props: SupabaseMailProps) {
    super(scope, id);

    const { region, mesh } = props;

    const smtpEndpoint = `email-smtp.${region}.amazonaws.com`;

    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        virtualNodeName: 'AmazonSES',
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
