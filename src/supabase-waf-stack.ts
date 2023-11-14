import * as cdk from 'aws-cdk-lib';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class SupabaseWafStack extends cdk.Stack {
  readonly webAclId: string;

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    const webAcl = new waf.CfnWebACL(this, 'WebACL', {
      name: id,
      description: 'Web ACL for Supabase',
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: id,
      },
      defaultAction: { allow: {} },
      rules: [
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
          },
          overrideAction: { none: {} },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          },
          overrideAction: { none: {} },
        },
        {
          name: 'AWS-AWSManagedRulesBotControlRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesBotControlRuleSet',
              excludedRules: [
                { name: 'CategoryHttpLibrary' },
                { name: 'SignalNonBrowserUserAgent' },
              ],
              scopeDownStatement: {
                notStatement: {
                  statement: {
                    byteMatchStatement: {
                      fieldToMatch: { uriPath: {} },
                      positionalConstraint: 'STARTS_WITH',
                      searchString: '/pg/',
                      textTransformations: [{ priority: 0, type: 'NONE' }],
                    },
                  },
                },
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesBotControlRuleSet',
          },
          overrideAction: { none: {} },
        },
        {
          name: 'AWS-AWSManagedRulesATPRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesATPRuleSet',
              excludedRules: [
                { name: 'SignalMissingCredential' },
              ],
              managedRuleGroupConfigs: [
                { loginPath: '/auth/v1/token' },
                { payloadType: 'JSON' },
                { usernameField: { identifier: '/email' } },
                { passwordField: { identifier: '/password' } },
              ],
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesATPRuleSet',
          },
          overrideAction: { none: {} },
        },
        {
          name: 'RateBasedRule',
          priority: 4,
          statement: {
            rateBasedStatement: {
              limit: 5 * 60 * 100, // 100req/s
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateBasedRule',
          },
          action: { block: {} },
        },
      ],
    });

    this.webAclId = webAcl.ref;
  }
}
