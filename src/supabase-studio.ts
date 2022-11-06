import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { SupabaseService, SupabaseServiceProps } from './supabase-service';

export class SupabaseStudio extends SupabaseService {
  loadBalancer: elb.ApplicationLoadBalancer;
  userPool: cognito.UserPool;
  acmCertArn: cdk.CfnParameter;

  /**
   * Deploy Next.js on ECS Fargate with ApplicationLoadBalancer.
   * It is better, if you can deploy Next.js with Amplify Hosting or Lambda@edge.
   */
  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id, props);

    const vpc = props.cluster.vpc;

    const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
      protocol: elb.ApplicationProtocol.HTTP,
      port: this.listenerPort,
      targets: [
        this.ecsService.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      vpc,
    });

    const securityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      allowAllOutbound: true, // needed for cognito auth
      vpc,
    });

    this.loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', {
      internetFacing: true,
      //ipAddressType: elb.IpAddressType.DUAL_STACK,
      securityGroup,
      vpc,
    });
    this.loadBalancer.connections.allowFrom(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow from anyone on port 443');
    //this.loadBalancer.connections.allowFrom(ec2.Peer.anyIpv6(), ec2.Port.tcp(443));

    const listener = this.loadBalancer.addListener('Listener', {
      protocol: elb.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // for HTTPS
    this.acmCertArn = new cdk.CfnParameter(this, 'AcmCertArn', {
      description: 'ACM Certificate ARN for Supabase studio',
      type: 'String',
      default: '',
      allowedPattern: '^arn:aws:acm:[\\w-]+:[0-9]{12}:certificate/[\\w]{8}-[\\w]{4}-[\\w]{4}-[\\w]{4}-[\\w]{12}$|',
    });

    const httpsDisabled = new cdk.CfnCondition(this, 'HttpsDisabled', { expression: cdk.Fn.conditionEquals(this.acmCertArn, '') });

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      userPoolName: 'SupabaseStudio-UserPool',
      signInAliases: { username: false, email: true },
    });

    const domainPrefix = cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID));
    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'Client', {
      userPool: this.userPool,
      generateSecret: true,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        callbackUrls: [`https://${this.loadBalancer.loadBalancerDnsName}/oauth2/idpresponse`],
        logoutUrls: ['https://example.com'],
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID],
      },
    });
    const cfnListener = listener.node.defaultChild as elb.CfnListener;
    cfnListener.addPropertyOverride('Protocol', cdk.Fn.conditionIf(httpsDisabled.logicalId, 'HTTP', 'HTTPS'));
    cfnListener.addPropertyOverride('Port', cdk.Fn.conditionIf(httpsDisabled.logicalId, 80, 443));
    cfnListener.addPropertyOverride('Certificates', cdk.Fn.conditionIf(httpsDisabled.logicalId, cdk.Aws.NO_VALUE, [{ CertificateArn: this.acmCertArn.valueAsString }]));
    cfnListener.addPropertyOverride('DefaultActions.0.Order', cdk.Fn.conditionIf(httpsDisabled.logicalId, 1, 2));
    cfnListener.addPropertyOverride('DefaultActions.1', cdk.Fn.conditionIf(httpsDisabled.logicalId, cdk.Aws.NO_VALUE, {
      Order: 1,
      Type: 'authenticate-cognito',
      AuthenticateCognitoConfig: {
        UserPoolArn: this.userPool.userPoolArn,
        UserPoolClientId: userPoolClient.userPoolClientId,
        UserPoolDomain: domainPrefix,
      },
    }));

  }
}
