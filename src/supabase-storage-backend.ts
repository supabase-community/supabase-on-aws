import * as cdk from 'aws-cdk-lib';
import * as appmesh from 'aws-cdk-lib/aws-appmesh';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SupabaseServiceBase } from './supabase-service';

interface SupabaseStorageBackendProps {
  mesh?: appmesh.IMesh;
}

export class SupabaseStorageBackend extends SupabaseServiceBase {
  bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SupabaseStorageBackendProps) {
    super(scope, id);

    const mesh = props.mesh;

    this.bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    if (typeof mesh != 'undefined') {
      const s3Endpoint = `s3.${cdk.Aws.REGION}.amazonaws.com`;
      this.virtualNode = new appmesh.VirtualNode(this, 'VirtualNode', {
        virtualNodeName: 'AmazonS3',
        serviceDiscovery: appmesh.ServiceDiscovery.dns(s3Endpoint, appmesh.DnsResponseType.LOAD_BALANCER),
        listeners: [appmesh.VirtualNodeListener.http({ port: 443 })],
        mesh,
      });

      this.virtualService = new appmesh.VirtualService(this, 'VirtualService', {
        virtualServiceName: s3Endpoint,
        virtualServiceProvider: appmesh.VirtualServiceProvider.virtualNode(this.virtualNode),
      });
    }

  }
}
