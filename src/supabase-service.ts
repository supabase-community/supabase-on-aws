import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancedTaskImageOptions } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
//import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { SupabaseDatabase } from './supabase-db';

interface SupabaseTaskImageOptions extends NetworkLoadBalancedTaskImageOptions {
  containerPort: number;
  healthCheck?: ecs.HealthCheck;
  command?: string[];
}

export interface SupabaseServiceProps {
  cluster: ecs.ICluster;
  taskImageOptions: SupabaseTaskImageOptions;
  taskSpec?: {
    cpuArchitecture?: 'x86_64'|'arm64';
    cpu?: string;
    memory?: string;
    minTasks?: cdk.CfnParameter;
    maxTasks?: cdk.CfnParameter;
  };
}

export class SupabaseService extends Construct {
  listenerPort: number;
  dnsName: string;
  ecsService: ecs.FargateService;
  cloudMapService: servicediscovery.Service;
  logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, taskImageOptions, taskSpec } = props;
    const cpu = taskSpec?.cpu || '256';
    const memory = taskSpec?.memory || '512';
    const minTasks = taskSpec?.minTasks?.valueAsNumber || 1;
    const maxTasks = taskSpec?.maxTasks?.valueAsNumber || 20;
    const cpuArchitecture = (taskSpec?.cpuArchitecture == 'x86_64') ? ecs.CpuArchitecture.X86_64 : ecs.CpuArchitecture.ARM64;

    const serviceDisabled = (typeof taskSpec?.minTasks != 'undefined' && typeof taskSpec?.maxTasks != 'undefined')
      ? new cdk.CfnCondition(this, 'ServiceDisabled', { expression: cdk.Fn.conditionAnd(cdk.Fn.conditionEquals(taskSpec?.minTasks, '0'), cdk.Fn.conditionEquals(taskSpec?.maxTasks, '0')) })
      : undefined;

    this.listenerPort = taskImageOptions.containerPort;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture,
      },
    });
    (taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Cpu', cpu);
    (taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Memory', memory);

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const logDriver = new ecs.AwsLogDriver({ logGroup: this.logGroup, streamPrefix: 'ecs' });

    const containerName = taskImageOptions.containerName ?? 'app';
    const appContainer = taskDefinition.addContainer(containerName, {
      image: taskImageOptions.image,
      logging: logDriver,
      environment: taskImageOptions.environment,
      secrets: taskImageOptions.secrets,
      dockerLabels: taskImageOptions.dockerLabels,
      healthCheck: taskImageOptions.healthCheck,
      command: taskImageOptions.command,
    });
    appContainer.addPortMappings({ containerPort: taskImageOptions.containerPort });
    appContainer.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });

    //const otelPolicy = new iam.Policy(this, 'OpenTelemetryPolicy', {
    //  policyName: 'OpenTelemetryPolicy',
    //  statements: [new iam.PolicyStatement({
    //    actions: [
    //      'logs:PutLogEvents',
    //      'logs:CreateLogGroup',
    //      'logs:CreateLogStream',
    //      'logs:DescribeLogStreams',
    //      'logs:DescribeLogGroups',
    //      'xray:PutTraceSegments',
    //      'xray:PutTelemetryRecords',
    //      'xray:GetSamplingRules',
    //      'xray:GetSamplingTargets',
    //      'xray:GetSamplingStatisticSummaries',
    //      'ssm:GetParameters',
    //    ],
    //    resources: ['*'],
    //  })],
    //});
    //taskDefinition.taskRole.attachInlinePolicy(otelPolicy);
    //const otelContainer = taskDefinition.addContainer('otel-collector', {
    //  image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:latest'),
    //  command: ['--config=/etc/ecs/ecs-xray.yaml'],
    //  //cpu: Math.round(cpu * otelCpuRate),
    //  //memoryReservationMiB: Math.round(memory * otelMemRate),
    //  essential: true,
    //  //healthCheck: {
    //  //  command: ["CMD-SHELL", "curl -f http://127.0.0.1:13133/ || exit 1"],
    //  //  interval: cdk.Duration.seconds(5),
    //  //  timeout: cdk.Duration.seconds(2),
    //  //  startPeriod: cdk.Duration.seconds(10),
    //  //  retries: 3,
    //  //},
    //  readonlyRootFilesystem: true,
    //  logging: logDriver,
    //});
    //appContainer.addContainerDependencies({
    //  container: otelContainer,
    //  condition: ecs.ContainerDependencyCondition.START,
    //});

    this.ecsService = new ecs.FargateService(this, 'Fargate', {
      cluster,
      taskDefinition,
      circuitBreaker: { rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      //capacityProviderStrategies: [
      //  { capacityProvider: 'FARGATE', base: 1, weight: 1 },
      //  { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 0 },
      //],
    });
    if (typeof serviceDisabled != 'undefined') {
      (this.ecsService.node.defaultChild as ecs.CfnService).addPropertyOverride('DesiredCount', cdk.Fn.conditionIf(serviceDisabled.logicalId, 0, cdk.Aws.NO_VALUE));
    }

    this.cloudMapService = this.ecsService.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (this.cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    this.dnsName = `${this.cloudMapService.serviceName}.${this.cloudMapService.namespace.namespaceName}`;

    const autoScaling = this.ecsService.autoScaleTaskCount({ minCapacity: minTasks, maxCapacity: maxTasks });
    autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

  }

  addNetworkLoadBalancer(props: { healthCheckPort: number}) {
    const healthCheckPort = props.healthCheckPort;

    const vpc = this.ecsService.cluster.vpc;
    this.ecsService.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(healthCheckPort), 'NLB healthcheck');

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
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.ecsService.connections.allowToDefaultPort(backend.cluster);
    this.ecsService.node.defaultChild?.node.addDependency(backend.cluster.node.findChild('Instance1'));
  }
}
