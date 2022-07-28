import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancedFargateService, ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface SupabaseServiceProps {
  cluster: ecs.ICluster;
  containerDefinition: ecs.ContainerDefinitionOptions;
  gateway?: 'nlb'|'alb';
}

export class SupabaseService extends Construct {
  service: ecs.BaseService;
  loadBalancer?: elb.ILoadBalancerV2;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, containerDefinition } = props;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });

    const container = taskDefinition.addContainer('app', {
      ...containerDefinition,
      logging: new ecs.AwsLogDriver({ streamPrefix: 'ecs' }),
    });
    container.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });

    const cloudMapOptions: ecs.CloudMapOptions = {
      dnsTtl: cdk.Duration.seconds(10),
      name: serviceName,
    };
    const circuitBreaker: ecs.DeploymentCircuitBreaker = { rollback: true };

    if (props.gateway == 'nlb') {
      const vpcInternal = ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock);
      const containerPort = ec2.Port.tcp(container.containerPort);
      const nlbService = new NetworkLoadBalancedFargateService(this, 'Svc', {
        cluster,
        taskDefinition,
        circuitBreaker,
        cloudMapOptions,
        healthCheckGracePeriod: cdk.Duration.seconds(10),
      });
      nlbService.targetGroup.configureHealthCheck({ interval: cdk.Duration.seconds(10) });
      nlbService.service.connections.allowFrom(vpcInternal, containerPort, 'NLB healthcheck');
      nlbService.service.connections.allowFrom(ec2.Peer.prefixList('pl-82a045eb'), containerPort, 'CloudFront');
      this.service = nlbService.service;
      this.loadBalancer = nlbService.loadBalancer;
    } else if (props.gateway == 'alb') {
      const albService = new ApplicationLoadBalancedFargateService(this, 'Svc', {
        cluster,
        taskDefinition,
        circuitBreaker,
        cloudMapOptions,
        healthCheckGracePeriod: cdk.Duration.seconds(10),
      });
      albService.targetGroup.configureHealthCheck({ interval: cdk.Duration.seconds(10), timeout: cdk.Duration.seconds(5) });
      this.service = albService.service;
      this.loadBalancer = albService.loadBalancer;
    } else {
      this.service = new ecs.FargateService(this, 'Svc', {
        cluster,
        taskDefinition,
        circuitBreaker,
        cloudMapOptions,
      });
    };

  }
}
