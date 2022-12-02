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

    const forceDeployEcsTask = new CallAwsService(this, 'ForceDeployEcsTask', {
      comment: 'Force deploy ECS Tasks',
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

    const forceDeployment = new sfn.Map(this, 'ForceDeployment', {
      itemsPath: sfn.JsonPath.stringAt('$.services'),
      parameters: {
        'service.$': '$$.Map.Item.Value',
      },
    });
    forceDeployment.iterator(forceDeployEcsTask);

    const getEcsServiceList = new CallAwsService(this, 'GetEcsServiceList', {
      comment: 'Fetch ECS Services',
      service: 'ECS',
      action: 'listServices',
      parameters: {
        Cluster: cluster.clusterName,
      },
      resultSelector: {
        'services.$': '$.ServiceArns',
      },
      iamResources: ['*'],
      iamAction: 'ecs:ListServices',
    });
    getEcsServiceList.next(forceDeployment);

    const checkInput = new sfn.Choice(this, 'CheckInput');
    checkInput.when(sfn.Condition.isPresent('$.services'), forceDeployment);
    checkInput.otherwise(getEcsServiceList);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition: checkInput,
    });

  }

  addTrigger(props: TriggerProps) {
    const rule = props.rule;
    const services = props.services?.map(x => x.service.serviceArn);
    const target = new targets.SfnStateMachine(this.stateMachine, {
      input: events.RuleTargetInput.fromObject({ services }),
    });
    rule.addTarget(target);
  }
}

interface TriggerProps {
  rule: events.Rule;
  services?: BaseFargateService[];
}
