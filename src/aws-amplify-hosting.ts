import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as cr from 'aws-cdk-lib/custom-resources';

interface AmplifyHostingProps {
  sourceUrl: string;
  appRoot: string;
  environmentVariables?: {
    [name: string]: string;
  }
  liveUpdates: { pkg: string, type: 'nvm'|'npm'|'internal', version: string }[];
}

export class AmplifyHosting extends Construct {
  readonly app: amplify.App;

  constructor(scope: Construct, id: string, props: AmplifyHostingProps) {
    super(scope, id);

    const { sourceUrl, appRoot, environmentVariables, liveUpdates } = props;

    const repository = new codecommit.Repository(this, 'Repo', {
      repositoryName: this.node.path.replace(/\//g, ''),
    });

    const importRemoteAssetFunction = new lambda.DockerImageFunction(this, 'ImportRemoteAssetFunction', {
      description: 'Import remote asset into AWS CodeCommit',
      code: lambda.DockerImageCode.fromImageAsset('containers/asset-to-git'),
      memorySize: 10240,
      ephemeralStorageSize: cdk.Size.gibibytes(2),
      timeout: cdk.Duration.minutes(15),
    });
    repository.grantPullPush(importRemoteAssetFunction);

    const importRemoteAssetProvider = new cr.Provider(this, 'ImportRemoteAssetProvider', { onEventHandler: importRemoteAssetFunction })

    new cdk.CustomResource(this,'ImportRemoteAsset', {
      resourceType: 'Custom::ImportRemoteAsset',
      serviceToken: importRemoteAssetProvider.serviceToken,
      properties: {
        SourceUrl: sourceUrl,
        TargetRepo: repository.repositoryCloneUrlGrc,
      },
    });

    const amplifySSRLoggingRole = new iam.Role(this, 'AmplifySSRLoggingRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
    });

    const buildSpec = BuildSpec.fromObjectToYaml({
      version: 1,
      applications: [{
        appRoot,
        frontend: {
          phases: {
            preBuild: {
              commands: [
                'env | grep -e STUDIO_PG_META_URL -e POSTGRES_PASSWORD >> .env.production',
                'env | grep -e SUPABASE_ >> .env.production',
                'env | grep -e NEXT_PUBLIC_ >> .env.production',
                'npm ci || npm install',
              ],
            },
            build: {
              commands: [
                'npm run build',
                'npm prune --omit=dev',
              ],
            },
            postBuild: {
              commands: [
                `ln -s ${appRoot}/server.js .next/standalone/server.js`,
                `cp -r public .next/standalone/${appRoot}/public`,
                `cp -r .next/static .next/standalone/${appRoot}/.next/static`,
                `cp .env .env.production .next/standalone/${appRoot}`,
              ],
            },
          },
          artifacts: {
            baseDirectory: '.next',
            files: ['**/*'],
          },
          cache: {
            paths: [
              'node_modules/**/*',
              '.next/cache/**/*',
            ],
          },
        },
      }],
    });

    this.app = new amplify.App(this, 'App', {
      appName: this.node.path.replace(/\//g, ''),
      role: amplifySSRLoggingRole,
      sourceCodeProvider: new amplify.CodeCommitSourceCodeProvider({ repository }),
      buildSpec,
      environmentVariables,
    });
    (this.app.node.defaultChild as cdk.CfnResource).addPropertyOverride('Platform', 'WEB_COMPUTE');

    const outputFileTracingRoot = appRoot.split('/').map(x => x = '..').join('/') + '/';
    this.app.addEnvironment('NEXT_PRIVATE_OUTPUT_TRACE_ROOT', outputFileTracingRoot);

    this.app.addEnvironment('AMPLIFY_MONOREPO_APP_ROOT', appRoot);
    this.app.addEnvironment('AMPLIFY_DIFF_DEPLOY', 'false');
    this.app.addEnvironment('_LIVE_UPDATES', JSON.stringify(liveUpdates));

    this.app.addCustomRule({ source: '/<*>', target: '/index.html', status: amplify.RedirectStatus.NOT_FOUND_REWRITE });

    const branch = this.app.addBranch('ProdBranch', {
      branchName: 'main',
      stage: 'PRODUCTION',
      autoBuild: true,
      environmentVariables: {
        NEXT_PUBLIC_SITE_URL: `https://main.${this.app.appId}.amplifyapp.com`
      }
    });
    (branch.node.defaultChild as cdk.CfnResource).addPropertyOverride('Framework', 'Next.js - SSR');

    const amplifySSRLoggingPolicy = new iam.Policy(this, 'AmplifySSRLoggingPolicy', {
      policyName: `AmplifySSRLoggingPolicy-${this.app.appId}`,
      statements: [
        new iam.PolicyStatement({
          sid: 'PushLogs',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/amplify/${this.app.appId}:log-stream:*`]
        }),
        new iam.PolicyStatement({
          sid: 'CreateLogGroup',
          actions: ['logs:CreateLogGroup'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/amplify/*`]
        }),
        new iam.PolicyStatement({
          sid: 'DescribeLogGroups',
          actions: ['logs:DescribeLogGroups'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:*`]
        }),
      ],
    });
    amplifySSRLoggingPolicy.attachToRole(amplifySSRLoggingRole);

    new cdk.CfnOutput(this, 'Url', {
      value: `https://${branch.branchName}.${this.app.defaultDomain}`,
    });

  }

}
