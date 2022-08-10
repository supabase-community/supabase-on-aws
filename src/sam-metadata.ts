import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class SamMetadata extends Construct {

  constructor(scope: cdk.Stack, id: string) {

    scope.templateOptions.transforms = ['AWS::Serverless-2016-10-31'];
    scope.templateOptions.metadata = {
      'AWS::ServerlessRepo::Application': {
        Name: 'Supabase',
        Description: 'Self-hosted Supabase on AWS',
        Author: 'mats',
        SpdxLicenseId: 'Apache-2.0',
        LicenseUrl: 'LICENSE.txt',
        ReadmeUrl: 'README.md',
        HomePageUrl: 'https://github.com/mats16/supabase-on-aws',
        SourceCodeUrl: 'https://github.com/mats16/supabase-on-aws',
        SemanticVersion: '0.0.1',
      },
    };

    super(scope, id);
  }
}

