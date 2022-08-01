import { Duration } from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface SupabaseCdnProps {
  originLoadBalancer: elb.ILoadBalancerV2;
}

export class SupabaseCdn extends cf.Distribution {
  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {

    const loadBalancer = props.originLoadBalancer;

    const defaultBehavior: cf.BehaviorOptions = {
      origin: new LoadBalancerV2Origin(loadBalancer!, {
        protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
      }),
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
    };

    super(scope, id, {
      comment: `Supabase - ${id}`,
      defaultBehavior,
      additionalBehaviors: {
        '*.css': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.png': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.svg': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.woff': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.woff2': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
        '*.js': { ...defaultBehavior, cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED },
      },
      errorResponses: [
        { httpStatus: 400, ttl: Duration.seconds(10) },
        { httpStatus: 500, ttl: Duration.seconds(10) },
      ],
      enableIpv6: true,
    });
  }
};