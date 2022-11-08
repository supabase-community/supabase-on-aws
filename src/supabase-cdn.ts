import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { SupabaseStandardWaf } from './supabase-standard-waf';

interface SupabaseCdnProps {
  origin: string|elb.ILoadBalancerV2;
}

interface BehaviorProps {
  pathPattern: string;
  origin: string|elb.ILoadBalancerV2;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;
  defaultBehaviorOptions: cf.AddBehaviorOptions;
  webAclArn: cdk.CfnParameter;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const origin = (typeof props.origin == 'string')
      ? new HttpOrigin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY })
      : new LoadBalancerV2Origin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY });

    this.webAclArn = new cdk.CfnParameter(this, 'WebAclArn', {
      description: 'Web ACL for CloudFront.',
      type: 'String',
      default: '',
      allowedPattern: '^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/[\\w-]+/[\\w]{8}-[\\w]{4}-[\\w]{4}-[\\w]{4}-[\\w]{12}$|',
    });

    const managedWafEnabled = new cdk.CfnCondition(this, 'ManagedWafEnabled', { expression: cdk.Fn.conditionEquals(this.webAclArn, '') });

    const waf = new SupabaseStandardWaf(this, 'ManagedWaf', { description: 'Supabase Standard WAF' });
    (waf.node.defaultChild as cdk.CfnStack).addOverride('Condition', managedWafEnabled.logicalId);

    const webAclId = cdk.Fn.conditionIf(managedWafEnabled.logicalId, waf.webAcl.getAttString('Arn'), this.webAclArn.valueAsString);

    const cachePolicy = new cf.CachePolicy(this, 'CachePolicy', {
      cachePolicyName: `${cdk.Aws.STACK_NAME}-CachePolicy-${cdk.Aws.REGION}`,
      comment: 'Policy for Supabase API',
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(600),
      defaultTtl: cdk.Duration.seconds(2),
      headerBehavior: cf.CacheHeaderBehavior.allowList('Authorization', 'Host'),
      queryStringBehavior: cf.CacheQueryStringBehavior.all(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const responseHeadersPolicy = new cf.ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
      responseHeadersPolicyName: `${cdk.Aws.STACK_NAME}-ResponseHeadersPolicy-${cdk.Aws.REGION}`,
      comment: 'Policy for Supabase API',
      customHeadersBehavior: {
        customHeaders: [
          { header: 'server', value: 'cloudfront', override: true },
        ],
      },
    });

    this.defaultBehaviorOptions = {
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
      responseHeadersPolicy,
    };

    const staticContentBehavior: cf.BehaviorOptions = {
      ...this.defaultBehaviorOptions,
      cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      origin,
    };

    this.distribution = new cf.Distribution(this, 'Distribution', {
      webAclId: webAclId.toString(),
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      comment: `Supabase - CDN (${this.node.path}/Distribution)`,
      defaultBehavior: {
        ...this.defaultBehaviorOptions,
        origin,
      },
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

  addBehavior(props: BehaviorProps) {
    const origin = (typeof props.origin == 'string')
      ? new HttpOrigin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY })
      : new LoadBalancerV2Origin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY });
    this.distribution.addBehavior(props.pathPattern, origin, this.defaultBehaviorOptions);
  }
};
