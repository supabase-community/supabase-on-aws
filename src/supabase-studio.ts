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
  acmCertArnParameter: cdk.CfnParameter;

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

    const listener = this.loadBalancer.addListener('Listener', {
      protocol: elb.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // Graphiql - GraphQL Playground
    //const gqlContainer = this.addContainer('postgraphile', {
    //  image: ecs.ContainerImage.fromRegistry('public.ecr.aws/u3p7q2r8/postgraphile:latest'),
    //  //image: ecs.ContainerImage.fromAsset('./src/containers/postgraphile', { platform: Platform.LINUX_ARM64 }),
    //  portMappings: [{ containerPort: 5000 }],
    //  healthCheck: {
    //    command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1'],
    //    interval: cdk.Duration.seconds(5),
    //    timeout: cdk.Duration.seconds(5),
    //    retries: 3,
    //  },
    //  environment: {
    //    PG_IGNORE_RBAC: '1',
    //  },
    //  secrets: {
    //    //DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret, 'url'),
    //  },
    //});
    //const gqlTargetGroup = new elb.ApplicationTargetGroup(this, 'GqlTargetGroup', {
    //  protocol: elb.ApplicationProtocol.HTTP,
    //  port: gqlContainer.containerPort,
    //  targets: [this.ecsService.loadBalancerTarget({ containerName: 'postgraphile' })],
    //  healthCheck: {
    //    path: '/health',
    //    interval: cdk.Duration.seconds(10),
    //    timeout: cdk.Duration.seconds(5),
    //  },
    //  deregistrationDelay: cdk.Duration.seconds(30),
    //  vpc,
    //});
    //listener.addAction('GraphqlAction', {
    //  priority: 1,
    //  conditions: [elb.ListenerCondition.pathPatterns(['/graphql', '/graphiql'])],
    //  action: elb.ListenerAction.forward([gqlTargetGroup]),
    //});

    // for HTTPS
    const dummyCertArn = 'arn:aws:acm:us-west-2:123456789012:certificate/no-cert-it-is-not-secure-to-use-http';
    this.acmCertArnParameter = new cdk.CfnParameter(this, 'CertificateArn', {
      description: 'ACM Certificate ARN for Supabase studio',
      type: 'String',
      default: dummyCertArn,
      allowedPattern: '^arn:aws:acm:[\\w-]+:[0-9]{12}:certificate/[\\w-]{36}$',
    });

    const isHttp = new cdk.CfnCondition(this, 'HttpCondition', { expression: cdk.Fn.conditionEquals(this.acmCertArnParameter, dummyCertArn) });

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      userPoolName: 'SupabaseStudio-UserPool',
      signInAliases: { username: false, email: true },
    });

    const domainPrefix = `supabase-studio-${cdk.Aws.ACCOUNT_ID}`;
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
    cfnListener.addPropertyOverride('Protocol', cdk.Fn.conditionIf(isHttp.logicalId, 'HTTP', 'HTTPS'));
    cfnListener.addPropertyOverride('Port', cdk.Fn.conditionIf(isHttp.logicalId, 80, 443));
    cfnListener.addPropertyOverride('Certificates', cdk.Fn.conditionIf(isHttp.logicalId, cdk.Aws.NO_VALUE, [{ CertificateArn: this.acmCertArnParameter.valueAsString }]));
    cfnListener.addPropertyOverride('DefaultActions.0.Order', cdk.Fn.conditionIf(isHttp.logicalId, 1, 2));
    cfnListener.addPropertyOverride('DefaultActions.1', cdk.Fn.conditionIf(isHttp.logicalId, cdk.Aws.NO_VALUE, {
      Order: 1,
      Type: 'authenticate-cognito',
      AuthenticateCognitoConfig: {
        UserPoolArn: this.userPool.userPoolArn,
        UserPoolClientId: userPoolClient.userPoolClientId,
        UserPoolDomain: domainPrefix,
      },
    }));
    this.loadBalancer.connections.allowFrom(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow from anyone on port 443');
    //this.loadBalancer.connections.allowFrom(ec2.Peer.anyIpv6(), ec2.Port.tcp(443));

  }
}
