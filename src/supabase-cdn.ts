import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface SupabaseCdnProps {
  originLoadBalancer: elb.ILoadBalancerV2;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;
  wafWebAclArnParameter: cdk.CfnParameter;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const { originLoadBalancer } = props;

    const dummyWebAclArn = 'arn:aws:wafv2:us-east-1:123456789012:global/webacl/this-is-dummy/00000000-0000-0000-0000-000000000000';
    this.wafWebAclArnParameter = new cdk.CfnParameter(this, 'WafWebAclArn', {
      description: 'WAF Web ACL ARN for CDN',
      type: 'String',
      default: dummyWebAclArn,
      allowedPattern: '^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/[\\w-]+/[\\w-]{36}$',
    });

    const wafEnabled = new cdk.CfnCondition(this, 'WafEnabled', { expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.wafWebAclArnParameter, dummyWebAclArn)) });

    const defaultBehavior: cf.BehaviorOptions = {
      origin: new LoadBalancerV2Origin(originLoadBalancer, {
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
        { httpStatus: 500, ttl: cdk.Duration.seconds(0) },
        { httpStatus: 501, ttl: cdk.Duration.seconds(0) },
        { httpStatus: 502, ttl: cdk.Duration.seconds(0) },
        { httpStatus: 503, ttl: cdk.Duration.seconds(0) },
        { httpStatus: 504, ttl: cdk.Duration.seconds(0) },
      ],
    });
    (this.distribution.node.defaultChild as cf.CfnDistribution).addPropertyOverride('DistributionConfig.WebACLId', cdk.Fn.conditionIf(wafEnabled.logicalId, this.wafWebAclArnParameter.valueAsString, cdk.Aws.NO_VALUE));
  }
};