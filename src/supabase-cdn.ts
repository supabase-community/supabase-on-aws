import { Duration } from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface SupabaseCdnProps {
  originLoadBalancer: elb.ILoadBalancerV2;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const { originLoadBalancer } = props;

    const defaultBehavior: cf.BehaviorOptions = {
      origin: new LoadBalancerV2Origin(originLoadBalancer, {
        protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
      }),
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy: cf.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
      functionAssociations: [],
    };

    this.distribution = new cf.Distribution(this, 'Distribution', {
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
        { httpStatus: 500, ttl: Duration.seconds(60) },
        { httpStatus: 501, ttl: Duration.seconds(60) },
        { httpStatus: 502, ttl: Duration.seconds(60) },
        { httpStatus: 503, ttl: Duration.seconds(60) },
        { httpStatus: 504, ttl: Duration.seconds(60) },
      ],
      enableIpv6: true,
    });
  }
};