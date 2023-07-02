import * as cdk from 'aws-cdk-lib';
import { ScalableTarget, CfnScalableTarget, CfnScalingPolicy } from 'aws-cdk-lib/aws-applicationautoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { NetworkLoadBalancedTaskImageOptions } from 'aws-cdk-lib/aws-ecs-patterns';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
//import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudMap from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { AuthProvider } from './supabase-auth-provider';
import { FargateStack } from './supabase-stack';

interface SupabaseTaskImageOptions extends NetworkLoadBalancedTaskImageOptions {
  containerPort: number;
  healthCheck?: ecs.HealthCheck;
  entryPoint?: string[];
  command?: string[];
}

export interface BaseFargateServiceProps {
  serviceName?: string;
  cluster: ecs.ICluster;
  taskImageOptions: SupabaseTaskImageOptions;
  cpuArchitecture?: 'X86_64'|'ARM64';
  enableServiceConnect?: boolean;
  enableCloudMap?: boolean;
}

export interface AutoScalingFargateServiceProps extends BaseFargateServiceProps {
  minTaskCount?: number;
  maxTaskCount?: number;
  highAvailability?: cdk.CfnCondition;
}

export interface TargetGroupProps {
  healthCheck?: elb.HealthCheck;
}

export class BaseFargateService extends Construct {
  /**
   * The URL to connect to an API. The URL contains the protocol, a DNS name, and the port.
   * (e.g. `http://rest.supabase.internal:8000`)
   */
  readonly endpoint: string;
  /**
   * This creates a service using the Fargate launch type on an ECS cluster.
   * @resource — AWS::ECS::Service
   */
  readonly service: ecs.FargateService;
  /**
   * Manage the allowed network connections for constructs with Security Groups.
   */
  readonly connections: ec2.Connections;

  constructor(scope: Construct, id: string, props: BaseFargateServiceProps) {
    super(scope, id);

    const serviceName = props.serviceName || id.toLowerCase();
    const { cluster, taskImageOptions } = props;
    const containerPort = taskImageOptions.containerPort;
    const cpuArchitecture = (props.cpuArchitecture == 'X86_64') ? ecs.CpuArchitecture.X86_64 : ecs.CpuArchitecture.ARM64;
    const enableServiceConnect = (typeof props.enableServiceConnect == 'undefined') ? true : props.enableServiceConnect;
    const enableCloudMap = (typeof props.enableCloudMap == 'undefined') ? true : props.enableCloudMap;

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

    /** awslogs log driver */
    const logDriver = new ecs.AwsLogDriver({ logGroup, streamPrefix: 'ecs' });

    /** The name of default container */
    const containerName = taskImageOptions.containerName ?? 'app';

    /** Default container */
    const appContainer = taskDefinition.addContainer(containerName, {
      image: taskImageOptions.image,
      logging: logDriver,
      environment: taskImageOptions.environment,
      secrets: taskImageOptions.secrets,
      dockerLabels: taskImageOptions.dockerLabels,
      healthCheck: taskImageOptions.healthCheck,
      entryPoint: taskImageOptions.entryPoint,
      command: taskImageOptions.command,
    });
    appContainer.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 65536, hardLimit: 65536 });
    appContainer.addPortMappings({ name: 'http', containerPort: taskImageOptions.containerPort });

    this.service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      circuitBreaker: { rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    if (enableServiceConnect) {
      this.service.enableServiceConnect({
        services: [{
          portMappingName: 'http',
          discoveryName: serviceName,
        }],
        logDriver,
      });
    }

    if (enableCloudMap) {
      const cloudMapService = this.service.enableCloudMap({
        cloudMapNamespace: cluster.defaultCloudMapNamespace,
        name: serviceName,
        container: appContainer,
        dnsRecordType: cloudMap.DnsRecordType.SRV,
        dnsTtl: cdk.Duration.seconds(10),
      });
      (cloudMapService.node.defaultChild as cloudMap.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });
    }

    this.connections = new ec2.Connections({
      defaultPort: ec2.Port.tcp(containerPort),
      securityGroups: this.service.connections.securityGroups,
    });

    this.endpoint = `http://${serviceName}.${cluster.defaultCloudMapNamespace?.namespaceName}:${containerPort}`;
  }

  /** Create a Target Group and link it to the ECS Service. */
  addTargetGroup(props?: TargetGroupProps) {
    const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
      protocol: elb.ApplicationProtocol.HTTP,
      port: Number(this.connections.defaultPort),
      targets: [this.service.loadBalancerTarget({ containerName: 'app' })],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: props?.healthCheck,
      vpc: this.service.cluster.vpc,
    });
    return targetGroup;
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

export class AutoScalingFargateService extends BaseFargateService {
  readonly taskSize: cdk.CfnParameter;

  constructor(scope: FargateStack, id: string, props: AutoScalingFargateServiceProps) {
    super(scope, id, props);

    const { minTaskCount, maxTaskCount, highAvailability } = props;

    this.taskSize = new cdk.CfnParameter(this, 'TaskSize', {
      description: 'Fargare task size',
      type: 'String',
      default: 'medium',
      allowedValues: ['none', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge'],
    });

    /** CFn task definition to override */
    const taskDef = this.service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition;

    const cpu = scope.taskSizeMapping.findInMap(this.taskSize.valueAsString, 'cpu');
    const memory = scope.taskSizeMapping.findInMap(this.taskSize.valueAsString, 'memory');

    taskDef.addPropertyOverride('Cpu', cpu);
    taskDef.addPropertyOverride('Memory', memory);

    const autoScaling = this.service.autoScaleTaskCount({
      minCapacity: minTaskCount ?? 2,
      maxCapacity: maxTaskCount ?? 20,
    });

    autoScaling.scaleOnCpuUtilization('ScaleOnCpu', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    /** CFn condition for ECS service */
    const serviceEnabled = new cdk.CfnCondition(this, 'ServiceEnabled', { expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.taskSize, 'none')) });
    (this.service.node.defaultChild as ecs.CfnService).addPropertyOverride('DesiredCount', cdk.Fn.conditionIf(serviceEnabled.logicalId, cdk.Aws.NO_VALUE, 0));

    if (typeof highAvailability != 'undefined') {
      /** CFn condition for auto-scaling */
      const autoScalingEnabled = new cdk.CfnCondition(this, 'AutoScalingEnabled', { expression: cdk.Fn.conditionAnd(serviceEnabled, highAvailability) });
      const target = autoScaling.node.findChild('Target') as ScalableTarget;
      (target.node.defaultChild as CfnScalableTarget).cfnOptions.condition = autoScalingEnabled;
      (target.node.findChild('ScaleOnCpu').node.defaultChild as CfnScalingPolicy).cfnOptions.condition = autoScalingEnabled;
    }
  }
}
