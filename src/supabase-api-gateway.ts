import * as apigw from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpServiceDiscoveryIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { SupabaseService, SupabaseServiceProps } from './supabase-service';

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
        allowOrigins: ['https://*'],
        allowHeaders: ['Accept-Profile', 'Apikey', 'Authorization', 'X-Client-Info'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
        exposeHeaders: ['*'],
        allowCredentials: true,
      },
    });

    this.domainName = cdk.Fn.select(2, cdk.Fn.split('/', this.api.apiEndpoint));
  }

  addRoute(path: string, service: SupabaseService) {
    const integration = new HttpServiceDiscoveryIntegration(service.node.id, service.cloudMapService, { vpcLink: this.vpcLink });
    this.api.addRoutes({ path, integration });
    this.securityGroup.connections.allowTo(service.ecsService, ec2.Port.tcp(service.listenerPort));
  }
}
