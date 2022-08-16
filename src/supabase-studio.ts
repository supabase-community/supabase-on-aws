import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { SupabaseService } from './supabase-service';

interface SupabaseStudioProps {
  cluster: ecs.Cluster;
  dbSecret: ISecret;
  jwtSecret: ISecret;
  supabaseUrl: string;
}

export class SupabaseStudio extends SupabaseService {
  loadBalancer: elb.ApplicationLoadBalancer;
  userPool: cognito.UserPool;

  /**
   * Deploy Next.js on ECS Fargate with ApplicationLoadBalancer.
   * It is better, if you can deploy Next.js with Amplify Hosting or Lambda@edge.
   */
  constructor(scope: Construct, id: string, props: SupabaseStudioProps) {
    const { cluster, dbSecret, jwtSecret, supabaseUrl } = props;
    const vpc = cluster.vpc;

    const supabaseStudioImage = new cdk.CfnParameter(scope, 'SupabaseStudioImage', {
      type: 'String',
      default: 'supabase/studio:latest',
    });

    super(scope, id, {
      cluster,
      containerDefinition: {
        image: ecs.ContainerImage.fromRegistry(supabaseStudioImage.valueAsString),
        portMappings: [{ containerPort: 3000 }],
        environment: {
          STUDIO_PG_META_URL: `${supabaseUrl}/pg`,
          SUPABASE_URL: supabaseUrl, // for API Docs
          SUPABASE_REST_URL: `${supabaseUrl}/rest/v1/`,
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
          SUPABASE_ANON_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'anon_key'),
          SUPABASE_SERVICE_KEY: ecs.Secret.fromSecretsManager(jwtSecret, 'service_role_key'),
        },
      },
      cpu: 256,
      memory: 512,
    });

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

    // for HTTPS
    const certArn = new cdk.CfnParameter(this, 'CertificateArn', {
      description: 'ACM Certificate ARN for Supabase studio',
      type: 'String',
      default: 'NO_CERT',
    });

    const isHttp = new cdk.CfnCondition(this, 'HttpCondition', { expression: cdk.Fn.conditionEquals(certArn, 'NO_CERT') });

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
    cfnListener.addPropertyOverride('Certificates', cdk.Fn.conditionIf(isHttp.logicalId, cdk.Aws.NO_VALUE, [{ CertificateArn: certArn.valueAsString }]));
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
