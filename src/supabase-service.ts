import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancedTaskImageOptions } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
//import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { AuthProvider } from './supabase-auth-provider';
import { SupabaseDatabase } from './supabase-db';
import { FargateStack } from './supabase-stack';

interface SupabaseTaskImageOptions extends NetworkLoadBalancedTaskImageOptions {
  containerPort: number;
  healthCheck?: ecs.HealthCheck;
  command?: string[];
}

export interface CloudMapFargateServiceProps {
  serviceName?: string;
  cluster: ecs.ICluster;
  taskImageOptions: SupabaseTaskImageOptions;
  cpuArchitecture?: 'x86_64'|'arm64';
}

export interface AutoScalingFargateServiceProps extends CloudMapFargateServiceProps {
  minTaskCount?: number;
  maxTaskCount?: number;
}

export class CloudMapFargateService extends Construct {
  readonly listenerPort: number;
  readonly dnsName: string;
  readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: CloudMapFargateServiceProps) {
    super(scope, id);

    const serviceName = props.serviceName || id.toLowerCase();
    const { cluster, taskImageOptions } = props;
    const cpuArchitecture = (props.cpuArchitecture == 'x86_64') ? ecs.CpuArchitecture.X86_64 : ecs.CpuArchitecture.ARM64;

    this.listenerPort = taskImageOptions.containerPort;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture,
      },
    });

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

    this.service = new ecs.FargateService(this, 'Fargate', {
      cluster,
      taskDefinition,
      circuitBreaker: { rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    const cloudMapService = this.service.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    this.dnsName = `${cloudMapService.serviceName}.${cloudMapService.namespace.namespaceName}`;

  }

  addApplicationLoadBalancer(props: { healthCheck?: elb.HealthCheck }) {
    const vpc = this.service.cluster.vpc;
    const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
      port: this.listenerPort,
      targets: [
        this.service.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        interval: cdk.Duration.seconds(10),
        ...props.healthCheck,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      vpc,
    });
    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', { internetFacing: true, vpc });
    loadBalancer.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
    const healthCheckPort = Number(props.healthCheck?.port || this.listenerPort);
    this.service.connections.allowFrom(loadBalancer, ec2.Port.tcp(healthCheckPort), 'ALB healthcheck');
    return loadBalancer;
  }

  addNetworkLoadBalancer(props: { healthCheck?: elb.HealthCheck }) {
    const vpc = this.service.cluster.vpc;
    const targetGroup = new elb.NetworkTargetGroup(this, 'TargetGroup', {
      port: this.listenerPort,
      targets: [
        this.service.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        interval: cdk.Duration.seconds(10),
        ...props.healthCheck,
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
    const healthCheckPort = Number(props.healthCheck?.port || this.listenerPort);
    this.service.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(healthCheckPort), 'NLB healthcheck');
    return loadBalancer;
  }

  addBackend(backend: CloudMapFargateService) {
    this.service.connections.allowTo(backend.service, ec2.Port.tcp(backend.listenerPort));
  }

  addDatabaseBackend(backend: SupabaseDatabase) {
    this.service.connections.allowToDefaultPort(backend.cluster);
    this.service.node.defaultChild?.node.addDependency(backend.cluster.node.findChild('Instance1'));
  }

  addExternalAuthProviders(redirectUri: string, providerCount: number) {
    const providers: AuthProvider[] = [];
    for (let i = 0; i < providerCount; i++) {
      const authProvider = new AuthProvider(this, `Provider${i+1}`);
      const container = this.service.taskDefinition.defaultContainer!;
      // Set environment variables
      container.addEnvironment(`GOTRUE_EXTERNAL_${authProvider.id}_ENABLED`, authProvider.enabled);
      container.addEnvironment(`GOTRUE_EXTERNAL_${authProvider.id}_REDIRECT_URI`, redirectUri);
      container.addSecret(`GOTRUE_EXTERNAL_${authProvider.id}_CLIENT_ID`, ecs.Secret.fromSsmParameter(authProvider.clientIdParameter));
      container.addSecret(`GOTRUE_EXTERNAL_${authProvider.id}_SECRET`, ecs.Secret.fromSsmParameter(authProvider.secretParameter));
      providers.push(authProvider);
    }
    return providers;
  }

}

export class AutoScalingFargateService extends CloudMapFargateService {
  readonly taskSize: cdk.CfnParameter;
  readonly minTaskCount: cdk.CfnParameter;
  readonly maxTaskCount: cdk.CfnParameter;

  constructor(scope: FargateStack, id: string, props: AutoScalingFargateServiceProps) {
    super(scope, id, props);

    const { minTaskCount, maxTaskCount } = props;

    this.taskSize = new cdk.CfnParameter(this, 'TaskSize', {
      description: 'Fargare task size',
      type: 'String',
      default: 'nano',
      allowedValues: ['nano', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge'],
    });

    const cpu = scope.taskSizeMapping.findInMap(this.taskSize.valueAsString, 'cpu');
    const memory = scope.taskSizeMapping.findInMap(this.taskSize.valueAsString, 'memory');

    (this.service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Cpu', cpu);
    (this.service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition).addPropertyOverride('Memory', memory);

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
    (this.service.node.defaultChild as ecs.CfnService).addPropertyOverride('DesiredCount', cdk.Fn.conditionIf(serviceDisabled.logicalId, 0, cdk.Aws.NO_VALUE));

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
}
