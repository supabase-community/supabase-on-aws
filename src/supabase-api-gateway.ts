import * as apigw from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpServiceDiscoveryIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { SupabaseService } from './supabase-service';

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

    const logGroup = new logs.LogGroup(this, 'Logs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

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

    const apiArn = `arn:${cdk.Aws.PARTITION}:apigateway:${cdk.Aws.REGION}::/apis/${this.api.apiId}`;
    const accessLogSettingsArn = `${apiArn}/stages/$default/accesslogsettings`;

    const accessLogSettings = new cr.AwsCustomResource(this, 'AccessLogSettings', {
      resourceType: 'Custom::ApiGatewayAccessLogSettings',
      onCreate: {
        service: 'ApiGatewayV2',
        action: 'updateStage',
        parameters: {
          ApiId: this.api.apiId,
          StageName: '$default',
          AccessLogSettings: {
            DestinationArn: logGroup.logGroupArn,
            Format: '{ "requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength" }',
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      },
      onUpdate: {
        service: 'ApiGatewayV2',
        action: 'updateStage',
        parameters: {
          ApiId: this.api.apiId,
          StageName: '$default',
          AccessLogSettings: {
            DestinationArn: logGroup.logGroupArn,
            Format: '{ "requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength" }',
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      },
      onDelete: {
        service: 'ApiGatewayV2',
        action: 'updateStage',
        parameters: {
          ApiId: this.api.apiId,
          StageName: '$default',
          AccessLogSettings: {},
        },
        physicalResourceId: cr.PhysicalResourceId.of(accessLogSettingsArn),
      },
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
          resources: [logGroup.logGroupArn],
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

    this.domainName = cdk.Fn.select(2, cdk.Fn.split('/', this.api.apiEndpoint));
  }

  addRoute(path: string, service: SupabaseService) {
    const parameterMapping = new apigw.ParameterMapping();
    parameterMapping.overwritePath(apigw.MappingValue.requestPathParam('proxy'));
    const integration = new HttpServiceDiscoveryIntegration(service.node.id, service.cloudMapService, { vpcLink: this.vpcLink, parameterMapping });
    this.api.addRoutes({ path, integration });
    this.securityGroup.connections.allowTo(service.ecsService, ec2.Port.tcp(service.listenerPort));
  }
}
