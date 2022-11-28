import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { CallAwsService } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { BaseFargateService } from './ecs-patterns';

interface ForceDeployJobProps {
  cluster: ecs.Cluster;
}

export class ForceDeployJob extends Construct {
  stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: ForceDeployJobProps) {
    super(scope, id);

    const cluster = props.cluster;

    const mapTask = new sfn.Map(this, 'Map', {
      itemsPath: sfn.JsonPath.stringAt('$.services'),
      parameters: {
        'service.$': '$$.Map.Item.Value',
      },
    });

    const updateServiceTask = new CallAwsService(this, 'UpdateServiceTask', {
      comment: 'Force deploy ECS Service',
      service: 'ECS',
      action: 'updateService',
      parameters: {
        'Cluster': cluster.clusterName,
        'Service.$': '$.service',
        'ForceNewDeployment': true,
      },
      iamResources: [`arn:${cdk.Aws.PARTITION}:ecs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:service/${cluster.clusterName}/*`],
      iamAction: 'ecs:UpdateService',
    });

    mapTask.iterator(updateServiceTask);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition: mapTask,
    });

  }

  addTrigger(props: { rule: events.Rule; services: (BaseFargateService|ApplicationLoadBalancedFargateService)[] }) {
    const { rule, services } = props;
    const target = new targets.SfnStateMachine(this.stateMachine, {
      input: events.RuleTargetInput.fromObject({
        services: services.map(x => x.service.serviceName),
      }),
    });
    rule.addTarget(target);
  }
}
