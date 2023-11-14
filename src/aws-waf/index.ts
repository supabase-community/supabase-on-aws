import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export class WebAcl extends cdk.NestedStack {
  webAclArn: string;

  /** Default Web ACL */
  constructor(scope: Construct, id: string, props: cdk.NestedStackProps) {
    super(scope, id, props);

    /** Custom resource handler */
    const crFunction = new NodejsFunction(this, 'Function', {
      description: `Supabase - Create Web ACL Function (${this.node.path}/Function)`,
      entry: path.resolve(__dirname, 'cr-web-acl.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
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

    /** Custom resource provider */
    const crProvider = new cr.Provider(this, 'Provider', { onEventHandler: crFunction });

    /** Web ACL */
    const resource = new cdk.CustomResource(this, 'Resource', {
      resourceType: 'Custom::WebACL',
      serviceToken: crProvider.serviceToken,
      properties: {
        Name: this.node.path.replace(/\//g, '-'),
        Description: this.node.path,
        Fingerprint: cdk.FileSystem.fingerprint(path.resolve(__dirname, 'cr-web-acl.ts')),
      },
    });

    this.webAclArn = resource.getAttString('Arn');
  }
};