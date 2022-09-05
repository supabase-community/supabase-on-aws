import { CreateWebACLCommandInput } from '@aws-sdk/client-wafv2';
import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseCdnProps {
  origin: elb.ILoadBalancerV2;
  requestRateLimit: number;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const { origin, requestRateLimit } = props;

    const createWebAclFunction = new NodejsFunction(this, 'CreateWebAclFunction', {
      description: 'Supabase - Create WAF Web ACL function',
      entry: './src/functions/create-web-acl.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(15),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['wafv2:DeleteWebACL', 'wafv2:GetWebACL'],
          resources: [`arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/webacl/${cdk.Aws.STACK_NAME}-*/*`],
        }),
        new iam.PolicyStatement({
          actions: ['wafv2:CreateWebACL', 'wafv2:UpdateWebACL'],
          resources: [
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/webacl/${cdk.Aws.STACK_NAME}-*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/ipset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/managedruleset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/regexpatternset/*/*`,
            `arn:${cdk.Aws.PARTITION}:wafv2:us-east-1:${cdk.Aws.ACCOUNT_ID}:global/rulegroup/*/*`,
          ],
        }),
      ],
    });

    const webAclProvider = new cr.Provider(this, 'WebAclProvider', { onEventHandler: createWebAclFunction });

    const webAclName = `${cdk.Aws.STACK_NAME}-${id}-WebAcl`;
    const webAcl = new cdk.CustomResource(this, 'WebAcl', {
      serviceToken: webAclProvider.serviceToken,
      resourceType: 'Custom::WebACL',
      properties: {
        Name: webAclName,
        Description: 'Web ACL for self-hosted Supabase',
        VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: webAclName },
        Scope: 'CLOUDFRONT',
        Rules: [
          {
            Name: 'AWS-AWSManagedRulesAmazonIpReputationList',
            Priority: 0,
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesAmazonIpReputationList',
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
            },
            OverrideAction: { None: {} },
          },
          {
            Name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
            Priority: 1,
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
            },
            OverrideAction: { None: {} },
          },
          {
            Name: 'AWS-AWSManagedRulesSQLiRuleSet',
            Priority: 2,
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesSQLiRuleSet',
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'AWS-AWSManagedRulesSQLiRuleSet',
            },
            OverrideAction: { None: {} },
          },
          {
            Name: 'AWS-AWSManagedRulesBotControlRuleSet',
            Priority: 3,
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesBotControlRuleSet',
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'AWS-AWSManagedRulesBotControlRuleSet',
            },
            OverrideAction: { None: {} },
          },
          {
            Name: 'AWS-AWSManagedRulesATPRuleSet',
            Priority: 4,
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesATPRuleSet',
                ExcludedRules: [
                  { Name: 'SignalMissingCredential' },
                ],
                ManagedRuleGroupConfigs: [
                  { LoginPath: '/auth/v1/token' },
                  { PayloadType: 'JSON' },
                  { UsernameField: { Identifier: '/email' } },
                  { PasswordField: { Identifier: '/password' } },
                ],
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'AWS-AWSManagedRulesATPRuleSet',
            },
            OverrideAction: { None: {} },
          },
          {
            Name: 'RateBasedRule',
            Priority: 5,
            Statement: {
              RateBasedStatement: {
                Limit: requestRateLimit,
                AggregateKeyType: 'IP',
              },
            },
            VisibilityConfig: {
              SampledRequestsEnabled: true,
              CloudWatchMetricsEnabled: true,
              MetricName: 'RateBasedRule',
            },
            Action: { Block: {} },
          },
        ],
        DefaultAction: { Allow: {} },
      } as CreateWebACLCommandInput,
    });

    const defaultBehavior: cf.BehaviorOptions = {
      origin: new LoadBalancerV2Origin(origin, {
        protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
      }),
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
    };

    const staticContentBehavior: cf.BehaviorOptions = {
      ...defaultBehavior,
      cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
    };

    this.distribution = new cf.Distribution(this, 'Distribution', {
      webAclId: webAcl.getAttString('Arn'),
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      comment: `Supabase - ${id}`,
      defaultBehavior,
      additionalBehaviors: {
        '*.css': staticContentBehavior,
        '*.png': staticContentBehavior,
        '*.jpg': staticContentBehavior,
        '*.jpeg': staticContentBehavior,
        '*.svg': staticContentBehavior,
        '*.woff': staticContentBehavior,
        '*.woff2': staticContentBehavior,
        '*.js': staticContentBehavior,
      },
      errorResponses: [
        { httpStatus: 500, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 501, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 502, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 503, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 504, ttl: cdk.Duration.seconds(10) },
      ],
    });
  }
};