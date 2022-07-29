import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancedFargateService, ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { SupabaseDatabase } from './supabase-db';

interface SupabaseServiceProps {
  cluster: ecs.ICluster;
  containerDefinition: ecs.ContainerDefinitionOptions;
  gateway?: 'nlb'|'alb';
  mesh?: appmesh.IMesh;
}

export class SupabaseService extends Construct {
  service: ecs.BaseService;
  listenerPort: number;
  virtualService?: appmesh.VirtualService;
  virtualNode?: appmesh.VirtualNode;
  loadBalancer?: elb.ILoadBalancerV2;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, containerDefinition, mesh } = props;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });

    const logging = new ecs.AwsLogDriver({ streamPrefix: 'ecs' });

    const appContainer = taskDefinition.addContainer('app', {
      ...containerDefinition,
      essential: true,
      logging,
    });
    appContainer.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });

    taskDefinition.addContainer('xray-daemon', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest'),
      cpu: 16,
      memoryReservationMiB: 64,
      essential: true,
      logging,
    });

    this.listenerPort = appContainer.containerPort;

    const cloudMapOptions: ecs.CloudMapOptions = {
      dnsTtl: cdk.Duration.seconds(10),
      name: serviceName,
    };
    const capacityProviderStrategies: ecs.CapacityProviderStrategy[] = [
      { capacityProvider: 'FARGATE', base: 1, weight: 1 },
      { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 0 },
    ];
    const circuitBreaker: ecs.DeploymentCircuitBreaker = { rollback: true };

    if (props.gateway == 'nlb') {
      const vpcInternal = ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock);
      const nlbService = new NetworkLoadBalancedFargateService(this, 'Svc', {
        cluster,
        taskDefinition,
        capacityProviderStrategies,
        circuitBreaker,
        cloudMapOptions,
        healthCheckGracePeriod: cdk.Duration.seconds(10),
      });
      nlbService.targetGroup.configureHealthCheck({ interval: cdk.Duration.seconds(10) });
      nlbService.service.connections.allowFrom(vpcInternal, ec2.Port.tcp(this.listenerPort), 'NLB healthcheck');
      nlbService.service.connections.allowFrom(ec2.Peer.prefixList('pl-82a045eb'), ec2.Port.tcp(this.listenerPort), 'CloudFront');
      this.service = nlbService.service;
      this.loadBalancer = nlbService.loadBalancer;
    } else if (props.gateway == 'alb') {
      const albService = new ApplicationLoadBalancedFargateService(this, 'Svc', {
        cluster,
        taskDefinition,
        capacityProviderStrategies,
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
        capacityProviderStrategies,
        circuitBreaker,
        cloudMapOptions,
      });
    };

    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        serviceDiscovery: appmesh.ServiceDiscovery.cloudMap(this.service.cloudMapService!),
        listeners: [appmesh.VirtualNodeListener.http({ port: this.listenerPort })],
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: `${serviceName}.${cluster.defaultCloudMapNamespace?.namespaceName}`,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });
    }

  }
  addBackend(backend: SupabaseService) {
    this.service.connections.allowTo(backend.service, ec2.Port.tcp(backend.listenerPort));
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.service.connections.allowToDefaultPort(backend);
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
  }
}
