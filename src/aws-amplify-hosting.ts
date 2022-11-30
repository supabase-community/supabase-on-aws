import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface AmplifyHostingProps {
  sourceRepo: string;
  sourceBranch: string;
  appRoot: string;
  environmentVariables?: {
    [name: string]: string;
  };
  liveUpdates: { pkg: string; type: 'nvm'|'npm'|'internal'; version: string }[];
}

export class AmplifyHosting extends Construct {
  readonly app: amplify.App;

  constructor(scope: Construct, id: string, props: AmplifyHostingProps) {
    super(scope, id);

    const { sourceRepo, sourceBranch, appRoot, environmentVariables = {}, liveUpdates } = props;

    const repository = new codecommit.Repository(this, 'Repo', {
      repositoryName: this.node.path.replace(/\//g, ''),
    });

    const copyGitRepoFunction = new lambda.Function(this, 'CopyGitRepoFunction', {
      description: 'Copy Git Repository',
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('./src/functions/copy-git-repo', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            '/bin/bash', '-c', [
              'mkdir -p /var/task/local/{bin,lib}',
              'yum install -y git',
              'cp /usr/bin/git /usr/libexec/git-core/git-remote-https /usr/libexec/git-core/git-remote-http /var/task/local/bin',
              'ldd /usr/bin/git | awk \'NF == 4 { system("cp " $3 " /var/task/local/lib/") }\'',
              'ldd /usr/libexec/git-core/git-remote-https | awk \'NF == 4 { system("cp " $3 " /var/task/local/lib/") }\'',
              'ldd /usr/libexec/git-core/git-remote-http | awk \'NF == 4 { system("cp " $3 " /var/task/local/lib/") }\'',
              'pip install -r requirements.txt -t /var/task',
              'cp -au /asset-input/index.py /var/task',
              'cp -aur /var/task/* /asset-output',
            ].join('&&'),
          ],
          user: 'root',
        },
      }),
      handler: 'index.handler',
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.gibibytes(2),
      timeout: cdk.Duration.minutes(3),
    });
    repository.grantPullPush(copyGitRepoFunction);

    const copyGitRepoProvider = new cr.Provider(this, 'CopyGitRepoProvider', { onEventHandler: copyGitRepoFunction });

    new cdk.CustomResource(this, 'CopyGitRepoJob', {
      resourceType: 'Custom::CopyGitRepoJob',
      serviceToken: copyGitRepoProvider.serviceToken,
      properties: {
        SourceRepo: sourceRepo,
        SourceBranch: sourceBranch,
        TargetRepo: repository.repositoryCloneUrlGrc,
        TargetBranch: 'main',
        Version: 4,
      },
    });

    const amplifySSRLoggingRole = new iam.Role(this, 'AmplifySSRLoggingRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
    });

    const envKeys = Object.keys(environmentVariables);
    const buildSpec = BuildSpec.fromObjectToYaml({
      version: 1,
      applications: [{
        appRoot,
        frontend: {
          phases: {
            preBuild: {
              commands: [
                `env | grep ${envKeys.map(key => `-e ${key}`).join(' ')} >> .env.production`,
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

    const prodBranch = this.app.addBranch('ProdBranch', {
      branchName: 'main',
      stage: 'PRODUCTION',
      autoBuild: true,
      environmentVariables: {
        NEXT_PUBLIC_SITE_URL: `https://main.${this.app.appId}.amplifyapp.com`,
      },
    });
    (prodBranch.node.defaultChild as cdk.CfnResource).addPropertyOverride('Framework', 'Next.js - SSR');

    const amplifySSRLoggingPolicy = new iam.Policy(this, 'AmplifySSRLoggingPolicy', {
      policyName: `AmplifySSRLoggingPolicy-${this.app.appId}`,
      statements: [
        new iam.PolicyStatement({
          sid: 'PushLogs',
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/amplify/${this.app.appId}:log-stream:*`],
        }),
        new iam.PolicyStatement({
          sid: 'CreateLogGroup',
          actions: ['logs:CreateLogGroup'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/amplify/*`],
        }),
        new iam.PolicyStatement({
          sid: 'DescribeLogGroups',
          actions: ['logs:DescribeLogGroups'],
          resources: [`arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:*`],
        }),
      ],
    });
    amplifySSRLoggingPolicy.attachToRole(amplifySSRLoggingRole);

    new cdk.CfnOutput(this, 'Url', {
      value: `https://${prodBranch.branchName}.${this.app.defaultDomain}`,
    });

  }

}
