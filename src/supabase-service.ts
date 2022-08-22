import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { SupabaseDatabase } from './supabase-db';
import { SupabaseMailBase } from './supabase-mail';

export interface SupabaseServiceProps {
  cluster: ecs.ICluster;
  containerDefinition: ecs.ContainerDefinitionOptions;
  cpu?: number;
  memory?: number;
  cpuArchitecture?: ecs.CpuArchitecture;
  autoScalingEnabled?: boolean;
  mesh?: appmesh.Mesh;
}

export class SupabaseService extends Construct {
  listenerPort: number;
  ecsService: ecs.FargateService;
  cloudMapService: servicediscovery.Service;
  virtualService?: appmesh.VirtualService;
  virtualNode?: appmesh.VirtualNode;
  logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, containerDefinition, mesh } = props;
    const cpu = props.cpu || 512;
    const memory = props.memory || 1024;
    const cpuArchitecture = props.cpuArchitecture || ecs.CpuArchitecture.ARM64;
    const autoScalingEnabled = (typeof props.autoScalingEnabled == 'undefined') ? true : props.autoScalingEnabled;

    this.listenerPort = containerDefinition.portMappings![0].containerPort;

    const proxyConfiguration = new ecs.AppMeshProxyConfiguration({
      containerName: 'envoy',
      properties: {
        ignoredUID: 1337,
        ignoredGID: 1338,
        appPorts: [this.listenerPort],
        proxyIngressPort: 15000,
        proxyEgressPort: 15001,
        //egressIgnoredPorts: [2049], // EFS
        egressIgnoredIPs: ['169.254.170.2', '169.254.169.254'],
      },
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu,
      memoryLimitMiB: memory,
      runtimePlatform: { cpuArchitecture },
      proxyConfiguration: (typeof mesh != 'undefined') ? proxyConfiguration : undefined,
    });

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const logging = new ecs.AwsLogDriver({ logGroup: this.logGroup, streamPrefix: 'ecs' });

    const appContainer = taskDefinition.addContainer('app', {
      ...containerDefinition,
      essential: true,
      logging,
    });
    appContainer.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });

    this.ecsService = new ecs.FargateService(this, 'Svc', {
      cluster,
      taskDefinition,
      circuitBreaker: { rollback: true },
      //capacityProviderStrategies: [
      //  { capacityProvider: 'FARGATE', base: 1, weight: 1 },
      //  { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 0 },
      //],
    });

    this.cloudMapService = this.ecsService.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (this.cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    taskDefinition.executionRole!.attachInlinePolicy(new iam.Policy(this, 'SSMParameterPolicy', {
      statements: [new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [`arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/${cdk.Aws.STACK_NAME}/${id}/*`],
      })],
    }));

    if (autoScalingEnabled) {
      const autoScaling = this.ecsService.autoScaleTaskCount({ maxCapacity: 20 });
      autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
        targetUtilizationPercent: 50,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });
    }

    if (typeof mesh != 'undefined') {
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        virtualNodeName: id,
        serviceDiscovery: appmesh.ServiceDiscovery.cloudMap(this.ecsService.cloudMapService!),
        listeners: [appmesh.VirtualNodeListener.http({ port: this.listenerPort })],
        accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: `${serviceName}.${cluster.defaultCloudMapNamespace?.namespaceName}`,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });

      taskDefinition.taskRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AWSAppMeshEnvoyAccess' });
      taskDefinition.taskRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess' });

      const proxyContainer = taskDefinition.addContainer('envoy', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/appmesh/aws-appmesh-envoy:v1.22.2.0-prod'),
        user: '1337',
        cpu: 64,
        memoryReservationMiB: 128,
        essential: true,
        healthCheck: {
          command: ['CMD-SHELL', 'curl -s http://localhost:9901/server_info | grep state | grep -q LIVE'],
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(2),
          startPeriod: cdk.Duration.seconds(10),
          retries: 3,
        },
        environment: {
          APPMESH_VIRTUAL_NODE_NAME: `mesh/${mesh.meshName}/virtualNode/${this.virtualNode.virtualNodeName}`,
          ENVOY_ADMIN_ACCESS_LOG_FILE: '/dev/null',
          ENABLE_ENVOY_XRAY_TRACING: '1',
          XRAY_SAMPLING_RATE: '1.00',
        },
        readonlyRootFilesystem: false, // Envoy create a config file at bootstraping.
        logging,
      });
      proxyContainer.addUlimits({ name: ecs.UlimitName.NOFILE, hardLimit: 1024000, softLimit: 1024000 });

      appContainer.addContainerDependencies({
        container: proxyContainer,
        condition: ecs.ContainerDependencyCondition.HEALTHY,
      });

      taskDefinition.addContainer('xray-daemon', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest'),
        // TODO: Using ADOT collector, the console can't display well as App Mesh objects.
        //image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.20.0'),
        //command: ['--config=/etc/ecs/ecs-default-config.yaml'],
        user: '1337',
        cpu: 64,
        memoryReservationMiB: 128,
        essential: true,
        healthCheck: {
          command: ['CMD', '/xray', '--version', '||', 'exit 1'], // https://github.com/aws/aws-xray-daemon/issues/9
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(2),
          startPeriod: cdk.Duration.seconds(10),
          retries: 3,
        },
        readonlyRootFilesystem: true,
        logging,
      });

    }

  }

  addContainer(id: string, props: ecs.ContainerDefinitionOptions) {
    const container = this.ecsService.taskDefinition.addContainer(id, {
      ...props,
      logging: new ecs.AwsLogDriver({ logGroup: this.logGroup, streamPrefix: 'ecs' }),
    });
    return container;
  }

  addNetworkLoadBalancer() {
    const vpc = this.ecsService.cluster.vpc;
    const vpcInternal = ec2.Peer.ipv4(vpc.vpcCidrBlock);
    const healthCheckPort = ec2.Port.tcp(this.ecsService.taskDefinition.defaultContainer!.portMappings.slice(-1)[0].containerPort); // 2nd port
    this.ecsService.connections.allowFrom(vpcInternal, healthCheckPort, 'NLB healthcheck');

    const targetGroup = new elb.NetworkTargetGroup(this, 'TargetGroup', {
      port: this.listenerPort,
      targets: [
        this.ecsService.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        port: healthCheckPort.toString(),
        interval: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      preserveClientIp: true,
      vpc,
    });
    const loadBalancer = new elb.NetworkLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });
    loadBalancer.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
    return loadBalancer;
  }

  addBackend(backend: SupabaseService) {
    this.ecsService.connections.allowTo(backend.ecsService, ec2.Port.tcp(backend.listenerPort));
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.ecsService.connections.allowToDefaultPort(backend);
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
    this.ecsService.node.defaultChild?.node.addDependency(backend.node.findChild('Instance1'));
  }

  addExternalBackend(backend: SupabaseMailBase) {
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
  }
}
