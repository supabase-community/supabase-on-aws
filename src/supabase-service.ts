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
  taskSizeMapping: cdk.CfnMapping;
  cpuArchitecture?: 'x86_64'|'arm64';
  minTaskCount?: number;
  maxTaskCount?: number;
}

export class SupabaseService extends Construct {
  listenerPort: number;
  dnsName: string;
  service: ecs.FargateService;
  taskSize: cdk.CfnParameter;
  minTaskCount: cdk.CfnParameter;
  maxTaskCount: cdk.CfnParameter;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, taskImageOptions, taskSizeMapping, minTaskCount, maxTaskCount } = props;
    const cpuArchitecture = (props.cpuArchitecture == 'x86_64') ? ecs.CpuArchitecture.X86_64 : ecs.CpuArchitecture.ARM64;

    this.taskSize = new cdk.CfnParameter(this, 'TaskSize', {
      description: 'Fargare task size',
      type: 'String',
      default: 'nano',
      allowedValues: ['nano', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge'],
    });

    const cpu = taskSizeMapping.findInMap(this.taskSize.valueAsString, 'cpu');
    const memory = taskSizeMapping.findInMap(this.taskSize.valueAsString, 'memory');

    this.minTaskCount = new cdk.CfnParameter(this, 'MinTaskCount', {
      description: 'Minimum fargate task count',
      type: 'Number',
      default: (typeof minTaskCount == 'undefined') ? 1 : minTaskCount,
      minValue: 0,
    });
    this.maxTaskCount = new cdk.CfnParameter(this, 'MaxTaskCount', {
      description: 'Maximum fargate task count',
      type: 'Number',
      default: (typeof maxTaskCount == 'undefined') ? 20 : maxTaskCount,
      minValue: 0,
    });

    const serviceDisabled = new cdk.CfnCondition(this, 'ServiceDisabled', { expression: cdk.Fn.conditionEquals(this.minTaskCount, '0') });

    this.listenerPort = taskImageOptions.containerPort;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture,
      },
    });
    (taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Cpu', cpu);
    (taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Memory', memory);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const logDriver = new ecs.AwsLogDriver({ logGroup, streamPrefix: 'ecs' });

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

    this.service = new ecs.FargateService(this, 'Fargate', {
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
      (this.service.node.defaultChild as ecs.CfnService).addPropertyOverride('DesiredCount', cdk.Fn.conditionIf(serviceDisabled.logicalId, 0, cdk.Aws.NO_VALUE));
    }

    const cloudMapService = this.service.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    this.dnsName = `${cloudMapService.serviceName}.${cloudMapService.namespace.namespaceName}`;

    const autoScaling = this.service.autoScaleTaskCount({
      minCapacity: this.minTaskCount.valueAsNumber,
      maxCapacity: this.maxTaskCount.valueAsNumber,
    });
    autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

  }

  addNetworkLoadBalancer(props: { healthCheckPort?: number}) {
    const healthCheckPort = props.healthCheckPort || this.listenerPort;

    const vpc = this.service.cluster.vpc;
    this.service.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(healthCheckPort), 'NLB healthcheck');

    const targetGroup = new elb.NetworkTargetGroup(this, 'TargetGroup', {
      port: this.listenerPort,
      targets: [
        this.service.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        port: healthCheckPort.toString(),
        interval: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      preserveClientIp: true,
      vpc,
    });
    const loadBalancer = new elb.NetworkLoadBalancer(this, 'LoadBalancer', { internetFacing: true, crossZoneEnabled: true, vpc });
    loadBalancer.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
    return loadBalancer;
  }

  addBackend(backend: SupabaseService) {
    this.service.connections.allowTo(backend.service, ec2.Port.tcp(backend.listenerPort));
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.service.connections.allowToDefaultPort(backend.cluster);
    this.service.node.defaultChild?.node.addDependency(backend.cluster.node.findChild('Instance1'));
  }
}
