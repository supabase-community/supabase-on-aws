import { Duration } from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

const b64encode = (text: string) => Buffer.from(text).toString('base64');

interface SupabaseCdnProps {
  originLoadBalancer: elb.ILoadBalancerV2;
  basicAuth?: boolean;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const { originLoadBalancer, basicAuth } = props;

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

    if (basicAuth == true) {
      const basicAuthFunction = new cf.Function(this, 'BasicAuthFunction', {
        comment: 'Basic authentication',
        code: cf.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var headers = request.headers;

  var authString = "Basic ${b64encode('supabase:supabase')}";

  if (
    typeof headers.authorization === "undefined" ||
    headers.authorization.value !== authString
  ) {
    return {
      statusCode: 401,
      statusDescription: "Unauthorized",
      headers: { "www-authenticate": { value: "Basic" } }
    };
  }

  return request;
}
        `),
      });
      defaultBehavior.functionAssociations?.push({
        eventType: cf.FunctionEventType.VIEWER_REQUEST,
        function: basicAuthFunction,
      });
    }

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
        { httpStatus: 400, ttl: Duration.seconds(10) },
        { httpStatus: 500, ttl: Duration.seconds(10) },
      ],
      enableIpv6: true,
    });
  }
};