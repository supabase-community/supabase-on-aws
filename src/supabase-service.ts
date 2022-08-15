import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
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
  mesh?: appmesh.Mesh;
}

export class SupabaseService extends Construct {
  listenerPort: number;
  ecsService: ecs.FargateService;
  cloudMapService: servicediscovery.Service;
  virtualService?: appmesh.VirtualService;
  virtualNode?: appmesh.VirtualNode;

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {
    super(scope, id);

    const serviceName = id.toLowerCase();
    const { cluster, containerDefinition, cpu, memory, mesh } = props;
    const cpuArchitecture = props.cpuArchitecture || ecs.CpuArchitecture.ARM64;
    const vpc = cluster.vpc;

    this.listenerPort = containerDefinition.portMappings![0].containerPort;

    const proxyConfiguration = (typeof mesh == 'undefined') ? undefined : new ecs.AppMeshProxyConfiguration({
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
      proxyConfiguration,
    });

    const logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const logging = new ecs.AwsLogDriver({ logGroup, streamPrefix: 'ecs' });

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
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE', base: 1, weight: 1 },
        { capacityProvider: 'FARGATE_SPOT', base: 0, weight: 0 },
      ],
    });

    this.cloudMapService = this.ecsService.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: appContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (this.cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    const autoscaling = this.ecsService.autoScaleTaskCount({ maxCapacity: 20 });
    autoscaling.scaleOnCpuUtilization('ScaleOnCpu', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

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
        cpu: 80,
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
        logging,
      });
      proxyContainer.addUlimits({ name: ecs.UlimitName.NOFILE, hardLimit: 1024000, softLimit: 1024000 });

      appContainer.addContainerDependencies({
        container: proxyContainer,
        condition: ecs.ContainerDependencyCondition.HEALTHY,
      });

      taskDefinition.addContainer('xray-daemon', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:latest'),
        user: '1337',
        cpu: 16,
        memoryReservationMiB: 64,
        essential: true,
        portMappings: [{
          containerPort: 2000,
          protocol: ecs.Protocol.UDP,
        }],
        healthCheck: {
          command: ['CMD', '/xray', '--version', '||', 'exit 1'], // https://github.com/aws/aws-xray-daemon/issues/9
          interval: cdk.Duration.seconds(5),
          timeout: cdk.Duration.seconds(2),
          startPeriod: cdk.Duration.seconds(10),
          retries: 3,
        },
        logging,
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

  addApplicationLoadBalancer(userPoolArn: string, userPoolDomain: string) {
    const meshEnabled = (typeof this.virtualService == 'undefined') ? false : true;
    const vpc = this.ecsService.cluster.vpc;
    const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
      protocol: elb.ApplicationProtocol.HTTP,
      port: this.listenerPort,
      targets: [
        this.ecsService.loadBalancerTarget({ containerName: 'app' }),
      ],
      healthCheck: {
        port: (meshEnabled) ? '9901' : undefined,
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
    const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', {
      internetFacing: true,
      //ipAddressType: elb.IpAddressType.DUAL_STACK,
      securityGroup,
      vpc,
    });
    const listener = loadBalancer.addListener('Listener', {
      protocol: elb.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });
    // for HTTPS
    const certArn = new cdk.CfnParameter(this, 'CertificateArn', {
      description: 'ACM Certificate ARN for Supabase studio',
      type: 'String',
      default: 'NO_CERT',
    });
    const isHttp = new cdk.CfnCondition(this, 'isHttp', { expression: cdk.Fn.conditionEquals(certArn, 'NO_CERT') });
    const userPoolClient = new cognito.UserPoolClient(this, 'Client', {
      userPool: cognito.UserPool.fromUserPoolArn(this, 'UserPool', userPoolArn),
      generateSecret: true,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        callbackUrls: [`https://${loadBalancer.loadBalancerDnsName}/oauth2/idpresponse`],
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
        UserPoolArn: userPoolArn,
        UserPoolClientId: userPoolClient.userPoolClientId,
        UserPoolDomain: userPoolDomain,
      },
    }));
    loadBalancer.connections.allowFrom(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow from anyone on port 443');
    //loadBalancer.connections.allowFrom(ec2.Peer.anyIpv6(), ec2.Port.tcp(443));
    if (meshEnabled) {
      loadBalancer.connections.allowTo(this.ecsService, ec2.Port.tcp(9901), 'HealthCheck');
    }
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
  }

  addExternalBackend(backend: SupabaseMailBase) {
    if (typeof backend.virtualService != 'undefined') {
      this.virtualNode?.addBackend(appmesh.Backend.virtualService(backend.virtualService));
    }
  }
}
