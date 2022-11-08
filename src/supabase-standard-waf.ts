import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export class SupabaseStandardWaf extends cdk.NestedStack {
  webAcl: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: cdk.NestedStackProps) {
    super(scope, id, props);

    const crFunction = new NodejsFunction(this, 'Function', {
      description: `Supabase - Create Web ACL Function (${this.node.path}/Function)`,
      entry: './src/functions/create-web-acl.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(15),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            'wafv2:DeleteWebACL',
            'wafv2:GetWebACL',
          ],
          resources: [`arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/webacl/*/*`],
        }),
        new iam.PolicyStatement({
          actions: [
            'wafv2:CreateWebACL',
            'wafv2:UpdateWebACL',
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/webacl/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/ipset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/managedruleset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/regexpatternset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/rulegroup/*/*`,
          ],
        }),
      ],
    });

    const crProvider = new cr.Provider(this, 'Provider', { onEventHandler: crFunction });

    this.webAcl = new cdk.CustomResource(this, 'WebAcl', {
      serviceToken: crProvider.serviceToken,
      resourceType: 'Custom::WebACL',
      properties: {
        Name: `${this.node.path.split('/').join('-')}-${cdk.Aws.REGION}`,
        Description: `${this.node.path}/WebAcl`,
      },
    });

  }
};