import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { ApplicationLoadBalancedFargateService, ApplicationLoadBalancedFargateServiceProps } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export class CognitoAuthenticatedFargateService extends ApplicationLoadBalancedFargateService {
  userPool: cognito.UserPool;
  acmCertArn: cdk.CfnParameter;

  constructor(scope: Construct, id: string, props: ApplicationLoadBalancedFargateServiceProps) {
    super(scope, id, props);

    const autoScaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });
    autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // for HTTPS
    this.acmCertArn = new cdk.CfnParameter(this, 'AcmCertArn', {
      description: `ACM Certificate ARN for ${id} ALB with Cognito`,
      type: 'String',
      default: '',
      allowedPattern: '^arn:aws:acm:[\\w-]+:[0-9]{12}:certificate/[\\w]{8}-[\\w]{4}-[\\w]{4}-[\\w]{4}-[\\w]{12}$|',
    });
    const httpsEnabled = new cdk.CfnCondition(this, 'HttpsEnabled', { expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.acmCertArn, '')) });

    this.loadBalancer.connections.allowFrom(Peer.anyIpv4(), Port.tcp(443), 'Allow from anyone on port 443');

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      userPoolName: 'SupabaseStudio-UserPool',
      signInAliases: { username: false, email: true },
    });

    const domainPrefix = cdk.Fn.select(2, cdk.Fn.split('/', cdk.Aws.STACK_ID));
    const userPoolDomain = this.userPool.addDomain('Domain', {
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

    (this.userPool.node.defaultChild as cognito.CfnUserPool).cfnOptions.condition = httpsEnabled;
    (userPoolDomain.node.defaultChild as cognito.CfnUserPoolDomain).cfnOptions.condition = httpsEnabled;
    (userPoolClient.node.defaultChild as cognito.CfnUserPoolClient).cfnOptions.condition = httpsEnabled;

    const cfnListener = this.listener.node.defaultChild as elb.CfnListener;
    cfnListener.addPropertyOverride('Protocol', cdk.Fn.conditionIf(httpsEnabled.logicalId, 'HTTPS', 'HTTP'));
    cfnListener.addPropertyOverride('Port', cdk.Fn.conditionIf(httpsEnabled.logicalId, 443, 80));
    cfnListener.addPropertyOverride('Certificates', cdk.Fn.conditionIf(httpsEnabled.logicalId, [{ CertificateArn: this.acmCertArn.valueAsString }], cdk.Aws.NO_VALUE));
    cfnListener.addPropertyOverride('DefaultActions.0.Order', cdk.Fn.conditionIf(httpsEnabled.logicalId, 2, 1));
    cfnListener.addPropertyOverride('DefaultActions.1', cdk.Fn.conditionIf(httpsEnabled.logicalId, {
      Order: 1,
      Type: 'authenticate-cognito',
      AuthenticateCognitoConfig: {
        UserPoolArn: this.userPool.userPoolArn,
        UserPoolClientId: userPoolClient.userPoolClientId,
        UserPoolDomain: domainPrefix,
      },
    }, cdk.Aws.NO_VALUE));

  }
}