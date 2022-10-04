import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { SupabaseDatabase } from './supabase-db';

const otelCpuRate = 0.1;
const otelMemRate = 0.1;
const appCpuRate = 1.0 - otelCpuRate;
const appMemRate = 1.0 - otelMemRate;

export interface SupabaseServiceProps {
  cluster: ecs.ICluster;
  containerDefinition: ecs.ContainerDefinitionOptions;
  cpu?: number;
  memory?: number;
  cpuArchitecture?: ecs.CpuArchitecture;
  autoScalingEnabled?: boolean;
}

export class SupabaseService extends Construct {
  listenerPort: number;
  ecsService: ecs.FargateService;
  cloudMapService: servicediscovery.Service;
  logGroup: logs.LogGroup;
  forceDeployFunction: targets.LambdaFunction;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, containerDefinition } = props;
    const cpu = props.cpu || 1024;
    const memory = props.memory || 2048;
    const cpuArchitecture = props.cpuArchitecture || ecs.CpuArchitecture.ARM64;
    const autoScalingEnabled = (typeof props.autoScalingEnabled == 'undefined') ? true : props.autoScalingEnabled;

    this.listenerPort = containerDefinition.portMappings![0].containerPort;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu,
      memoryLimitMiB: memory,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture,
      },
    });

    const otelPolicy = new iam.Policy(this, 'OpenTelemetryPolicy', {
      policyName: 'OpenTelemetryPolicy',
      statements: [new iam.PolicyStatement({
        actions: [
          'logs:PutLogEvents',
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
          'xray:GetSamplingStatisticSummaries',
          'ssm:GetParameters',
        ],
        resources: ['*'],
      })],
    });
    taskDefinition.taskRole.attachInlinePolicy(otelPolicy);

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const awsLogDriver = new ecs.AwsLogDriver({ logGroup: this.logGroup, streamPrefix: 'ecs' });

    const appContainer = taskDefinition.addContainer('App', {
      ...containerDefinition,
      containerName: 'app',
      cpu: Math.round(cpu * appCpuRate),
      memoryReservationMiB: Math.round(memory * appMemRate),
      essential: true,
      logging: awsLogDriver,
    });
    appContainer.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });

    const otelContainer = taskDefinition.addContainer('OtelCollector', {
      containerName: 'otel-collector',
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:latest'),
      command: ['--config=/etc/ecs/ecs-xray.yaml'],
      cpu: Math.round(cpu * otelCpuRate),
      memoryReservationMiB: Math.round(memory * otelMemRate),
      essential: true,
      //healthCheck: {
      //  command: ["CMD-SHELL", "curl -f http://127.0.0.1:13133/ || exit 1"],
      //  interval: cdk.Duration.seconds(5),
      //  timeout: cdk.Duration.seconds(2),
      //  startPeriod: cdk.Duration.seconds(10),
      //  retries: 3,
      //},
      readonlyRootFilesystem: true,
      logging: awsLogDriver,
    });

    appContainer.addContainerDependencies({
      container: otelContainer,
      condition: ecs.ContainerDependencyCondition.START,
    });

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

    this.cloudMapService = this.ecsService.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (this.cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    this.forceDeployFunction = new targets.LambdaFunction(new NodejsFunction(this, 'ForceDeployFunction', {
      description: 'Supabase - Force deploy ECS service function',
      entry: 'src/functions/ecs-force-deploy.ts',
      runtime: lambda.Runtime.NODEJS_16_X,
      architecture: lambda.Architecture.ARM_64,
      environment: {
        ECS_CLUSTER_NAME: cluster.clusterName,
        ECS_SERVICE_NAME: this.ecsService.serviceName,
      },
      initialPolicy: [new iam.PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [this.ecsService.serviceArn],
      })],
    }));

    if (autoScalingEnabled) {
      const autoScaling = this.ecsService.autoScaleTaskCount({ maxCapacity: 100 });
      autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
        targetUtilizationPercent: 50,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });
    }

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
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.ecsService.connections.allowToDefaultPort(backend);
    this.ecsService.node.defaultChild?.node.addDependency(backend.node.findChild('Instance1'));

    new events.Rule(this, 'DatabaseSecretRotated', {
      description: `Supabase - Force deploy ${this.node.id}, when DB secret rotated`,
      eventPattern: {
        source: ['aws.secretsmanager'],
        detail: {
          eventName: ['RotationSucceeded'],
          additionalEventData: {
            SecretId: [backend.secret?.secretArn],
          },
        },
      },
      targets: [this.forceDeployFunction],
    });
  }
}
