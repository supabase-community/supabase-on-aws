import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

interface JaegerProps {
  cluster: ecs.Cluster;
}

export class Jaeger extends cdk.NestedStack {
  //service: ecs.FargateService;
  dnsName: string;

  constructor(scope: Construct, id: string, props: JaegerProps) {
    super(scope, id, { description: 'Jaeger: open source, end-to-end distributed tracing' });

    const serviceName = id.toLowerCase();
    const cluster = props.cluster;
    const vpc = cluster.vpc;

    const app = new ApplicationLoadBalancedFargateService(this, 'App', {
      cluster,
      taskImageOptions: {
        containerName: 'app',
        image: ecs.ContainerImage.fromRegistry('jaegertracing/all-in-one:1.38'),
        containerPort: 16686,
        environment: {
          COLLECTOR_OTLP_ENABLED: 'true',
        },
      },
      circuitBreaker: { rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    app.taskDefinition.defaultContainer?.addPortMappings({ containerPort: 4317 }, { containerPort: 4318 });
    app.taskDefinition.defaultContainer?.addUlimits({ name: ecs.UlimitName.NOFILE, softLimit: 262144, hardLimit: 262144 });

    const cloudMapService = app.service.enableCloudMap({
      name: serviceName,
      dnsRecordType: servicediscovery.DnsRecordType.SRV,
      container: app.taskDefinition.defaultContainer,
      dnsTtl: cdk.Duration.seconds(10),
    });
    (cloudMapService.node.defaultChild as servicediscovery.CfnService).addPropertyOverride('DnsConfig.DnsRecords.1', { Type: 'A', TTL: 10 });

    const vpcCidrBlock = ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock);
    app.service.connections.allowFrom(vpcCidrBlock, ec2.Port.tcp(4317), 'OpenTelemetry Protocol (OTLP) over gRPC');
    app.service.connections.allowFrom(vpcCidrBlock, ec2.Port.tcp(4318), 'OpenTelemetry Protocol (OTLP) over HTTP');

    this.dnsName = `${cloudMapService.serviceName}.${cloudMapService.namespace.namespaceName}`;

  }

}
