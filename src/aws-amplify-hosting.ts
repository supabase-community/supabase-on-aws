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
  environment?: {
    [name: string]: string;
  };
}

export class AmplifyHosting extends Construct {
  /** App in Amplify Hosting. It is a collection of branches. */
  readonly app: amplify.App;
  /** Production branch */
  readonly prodBranch: amplify.Branch;
  /** URL of production branch */
  readonly prodBranchUrl: string;

  /** Next.js App Hosting */
  constructor(scope: Construct, id: string, props: AmplifyHostingProps) {
    super(scope, id);

    const { sourceRepo, sourceBranch, appRoot, environment = {} } = props;

    /** CodeCommit - Source Repository for Amplify Hosting */
    const repository = new Repository(this, 'Repository', {
      repositoryName: cdk.Aws.STACK_NAME,
      description: `${this.node.path}/Repository`,
    });

    /** Import from GitHub to CodeComit */
    const repoImportJob = repository.importFromUrl(sourceRepo, sourceBranch);

    /** IAM Role for SSR app logging */
    const role = new iam.Role(this, 'Role', {
      description: 'The service role that will be used by AWS Amplify for SSR app logging.',
      path: '/service-role/',
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
    });

    /** Keys of environment variables */
    const envKeys = Object.keys(environment);

    /** BuildSpec for Amplify Hosting */
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
                'yum install -y rsync',
                'cd ../',
                'npx turbo@1.7.0 prune --scope=studio',
                'npm clean-install',
              ],
            },
            build: {
              commands: [
                'npx turbo run build --scope=studio --include-dependencies --no-deps',
                'npm prune --omit=dev',
              ],
            },
            postBuild: {
              commands: [
                `cd ${appRoot}`,
                `rsync -av --ignore-existing .next/standalone/${repository.repositoryName}/${appRoot}/ .next/standalone/`,
                `rsync -av --ignore-existing .next/standalone/${repository.repositoryName}/node_modules/ .next/standalone/node_modules/`,
                `rm -rf .next/standalone/${repository.repositoryName}`,
                'cp .env .env.production .next/standalone/',
                // https://nextjs.org/docs/advanced-features/output-file-tracing#automatically-copying-traced-files
                'rsync -av --ignore-existing public/ .next/standalone/public/',
                'rsync -av --ignore-existing .next/static/ .next/standalone/.next/static/',
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
      role,
      sourceCodeProvider: new amplify.CodeCommitSourceCodeProvider({ repository }),
      buildSpec,
      environmentVariables: {
        ...environment,
        NODE_OPTIONS: '--max-old-space-size=4096',
        AMPLIFY_MONOREPO_APP_ROOT: appRoot,
        AMPLIFY_DIFF_DEPLOY: 'false',
      },
      customRules: [
        { source: '/<*>', target: '/index.html', status: amplify.RedirectStatus.NOT_FOUND_REWRITE },
      ],
    });

    const cfnApp = this.app.node.defaultChild as cdk.aws_amplify.CfnApp;
    cfnApp.addPropertyOverride('Platform', 'WEB_COMPUTE');

    this.prodBranch = this.app.addBranch('ProdBranch', {
      branchName: 'main',
      stage: 'PRODUCTION',
      autoBuild: true,
      environmentVariables: {
        NEXT_PUBLIC_SITE_URL: `https://main.${this.app.appId}.amplifyapp.com`,
      },
    });
    (this.prodBranch.node.defaultChild as cdk.CfnResource).addPropertyOverride('Framework', 'Next.js - SSR');

    repoImportJob.node.addDependency(this.prodBranch.node.defaultChild!);

    /** IAM Policy for SSR app logging */
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
    amplifySSRLoggingPolicy.attachToRole(role);

    this.prodBranchUrl = `https://${this.prodBranch.branchName}.${this.app.defaultDomain}`;

    new cdk.CfnOutput(this, 'Url', { value: this.prodBranchUrl });
  }

}

export class Repository extends codecommit.Repository {
  readonly importFunction: lambda.Function;
  readonly importProvider: cr.Provider;

  /** CodeCommit to sync with GitHub */
  constructor(scope: Construct, id: string, props: codecommit.RepositoryProps) {
    super(scope, id, props);

    this.importFunction = new lambda.Function(this, 'ImportFunction', {
      description: 'Clone to CodeCommit from remote repo (You can execute this function manually.)',
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('./src/functions/copy-git-repo', {
        bundling: {
          image: cdk.DockerImage.fromRegistry('public.ecr.aws/sam/build-python3.9:latest-x86_64'),
          command: [
            '/bin/bash', '-c', [
              'mkdir -p /var/task/local/{bin,lib}',
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
      memorySize: 3072,
      ephemeralStorageSize: cdk.Size.gibibytes(3),
      timeout: cdk.Duration.minutes(5),
      environment: {
        TARGET_REPO: this.repositoryCloneUrlGrc,
      },
    });
    this.grantPullPush(this.importFunction);

    this.importProvider = new cr.Provider(this, 'ImportProvider', { onEventHandler: this.importFunction });
  }

  importFromUrl(sourceRepoUrlHttp: string, sourceBranch: string, targetBranch: string = 'main') {
    this.importFunction.addEnvironment('SOURCE_REPO', sourceRepoUrlHttp);
    this.importFunction.addEnvironment('SOURCE_BRANCH', sourceBranch);
    this.importFunction.addEnvironment('TARGET_BRANCH', targetBranch);

    return new cdk.CustomResource(this, targetBranch, {
      resourceType: 'Custom::RepoImportJob',
      serviceToken: this.importProvider.serviceToken,
      properties: {
        SourceRepo: sourceRepoUrlHttp,
        SourceBranch: sourceBranch,
      },
    });
  }
}
