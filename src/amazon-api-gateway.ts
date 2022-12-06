import * as apigw from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpServiceDiscoveryIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudMap from 'aws-cdk-lib/aws-servicediscovery';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { BaseFargateService } from './ecs-patterns';

interface ApiGatewayProps {
  vpc: ec2.IVpc;
}

export class ApiGateway extends Construct {
  securityGroup: ec2.SecurityGroup;
  vpcLink: apigw.VpcLink;
  api: apigw.HttpApi;
  domainName: string;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const { vpc } = props;

    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', { vpc, allowAllOutbound: false });

    this.vpcLink = new apigw.VpcLink(this, 'VpcLink', { vpc, securityGroups: [this.securityGroup] });

    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: this.node.path.replace(/\//g, '-'),
      corsPreflight: {
        allowOrigins: ['https://*', 'http://*'],
        //allowHeaders: ['Accept-Profile', 'Apikey', 'Authorization', 'X-Client-Info'],
        allowHeaders: ['*'],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        exposeHeaders: ['*'],
        allowCredentials: true,
      },
    });

    new AccessLog(this, 'AccessLog', { apiId: this.api.apiId });

    this.domainName = cdk.Fn.select(2, cdk.Fn.split('/', this.api.apiEndpoint));
  }

  addProxyRoute(path: string, service: BaseFargateService) {
    const cloudMapService = service.service.cloudMapService!;
    const parameterMapping = new apigw.ParameterMapping();
    parameterMapping.overwritePath(apigw.MappingValue.custom('/${request.path.proxy}'));
    const integration = new HttpServiceDiscoveryIntegration(service.node.id, cloudMapService, {
      vpcLink: this.vpcLink,
      parameterMapping,
    });
    this.api.addRoutes({
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.PUT],
      path: `${path}{proxy+}`,
      integration,
    });
    this.securityGroup.connections.allowToDefaultPort(service);
  }
}

interface AccessLogProps {
  apiId: string;
  stageName?: string;
  logFormat?: string;
}

class AccessLog extends logs.LogGroup {

  constructor(scope: Construct, id: string, props: AccessLogProps) {
    const removalPolicy = cdk.RemovalPolicy.DESTROY;
    const retention = logs.RetentionDays.ONE_MONTH;

    super(scope, id, { removalPolicy, retention });

    const apiId = props.apiId;
    const stageName = props.stageName || '$default';
    const logFormat = props.logFormat || '{ "requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength" }';

    const apiArn = `arn:${cdk.Aws.PARTITION}:apigateway:${cdk.Aws.REGION}::/apis/${apiId}`;
    const accessLogSettingsArn = `${apiArn}/stages/${stageName}/accesslogsettings`;

    new cr.AwsCustomResource(this, 'Settings', {
      resourceType: 'Custom::ApiGatewayAccessLogSettings',
      onCreate: {
        service: 'ApiGatewayV2',
        action: 'updateStage',
        parameters: {
          ApiId: apiId,
          StageName: stageName,
          AccessLogSettings: {
            DestinationArn: this.logGroupArn,
            Format: logFormat,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      },
      onUpdate: {
        service: 'ApiGatewayV2',
        action: 'updateStage',
        parameters: {
          ApiId: apiId,
          StageName: stageName,
          AccessLogSettings: {
            DestinationArn: this.logGroupArn,
            Format: logFormat,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      },
      //onDelete: {
      //  service: 'ApiGatewayV2',
      //  action: 'updateStage',
      //  parameters: {
      //    ApiId: apiId,
      //    StageName: stageName,
      //    AccessLogSettings: {},
      //  },
      //  physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      //},
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['apigateway:UpdateStage'],
          resources: [apiArn],
        }),
        new iam.PolicyStatement({
          actions: ['apigateway:PATCH'],
          resources: [`${apiArn}/stages/*`],
        }),
        new iam.PolicyStatement({
          actions: [
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
            'logs:GetLogEvents',
            'logs:FilterLogEvents',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: [
            'logs:CreateLogDelivery',
            'logs:PutResourcePolicy',
            'logs:UpdateLogDelivery',
            'logs:DeleteLogDelivery',
            'logs:CreateLogGroup',
            'logs:DescribeResourcePolicies',
            'logs:GetLogDelivery',
            'logs:ListLogDeliveries',
          ],
          resources: ['*'],
        }),
      ]),
    });

  }
}
