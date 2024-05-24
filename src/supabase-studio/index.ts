import * as path from 'path';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import { BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface SupabaseStudioProps {
  sourceBranch?: string;
  appRoot?: string;
  supabaseUrl: string;
  dbSecret: ISecret;
  anonKey: StringParameter;
  serviceRoleKey: StringParameter;
}

export class SupabaseStudio extends Construct {
  /** App in Amplify Hosting. It is a collection of branches. */
  readonly app: amplify.App;
  /** Production branch */
  readonly prodBranch: amplify.Branch;
  /** URL of production branch */
  readonly prodBranchUrl: string;

  /** Next.js app on Amplify Hosting */
  constructor(scope: Construct, id: string, props: SupabaseStudioProps) {
    super(scope, id);

    const buildImage = 'public.ecr.aws/sam/build-nodejs18.x:latest';
    const sourceRepo = 'https://github.com/supabase/supabase.git';
    const sourceBranch = props.sourceBranch ?? 'master';
    const appRoot = props.appRoot ?? 'studio';
    const { supabaseUrl, dbSecret, anonKey, serviceRoleKey } = props;

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

    // Allow the role to access Secret and Parameter
    dbSecret.grantRead(role);
    anonKey.grantRead(role);
    serviceRoleKey.grantRead(role);

    /** BuildSpec for Amplify Hosting */
    const buildSpec = BuildSpec.fromObjectToYaml({
      version: 1,
      applications: [{
        appRoot,
        frontend: {
          phases: {
            preBuild: {
              commands: [
                'echo POSTGRES_PASSWORD=$(aws secretsmanager get-secret-value --secret-id $DB_SECRET_ARN --query SecretString | jq -r . | jq -r .password) >> .env.production',
                'echo SUPABASE_ANON_KEY=$(aws ssm get-parameter --region $SUPABASE_REGION --name $ANON_KEY_NAME --query Parameter.Value) >> .env.production',
                'echo SUPABASE_SERVICE_KEY=$(aws ssm get-parameter --region $SUPABASE_REGION --name $SERVICE_KEY_NAME --query Parameter.Value) >> .env.production',
                'env | grep -e STUDIO_PG_META_URL >> .env.production',
                'env | grep -e SUPABASE_ >> .env.production',
                'env | grep -e NEXT_PUBLIC_ >> .env.production',
                'cd ../',
                'npx turbo@1.10.3 prune --scope=studio',
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
        // for Amplify Hosting Build
        NODE_OPTIONS: '--max-old-space-size=4096',
        AMPLIFY_MONOREPO_APP_ROOT: appRoot,
        AMPLIFY_DIFF_DEPLOY: 'false',
        _CUSTOM_IMAGE: buildImage,
        // for Supabase
        STUDIO_PG_META_URL: `${supabaseUrl}/pg`,
        SUPABASE_URL: `${supabaseUrl}`,
        SUPABASE_PUBLIC_URL: `${supabaseUrl}`,
        SUPABASE_REGION: serviceRoleKey.env.region,
        DB_SECRET_ARN: dbSecret.secretArn,
        ANON_KEY_NAME: anonKey.parameterName,
        SERVICE_KEY_NAME: serviceRoleKey.parameterName,
      },
      customRules: [
        { source: '/<*>', target: '/index.html', status: amplify.RedirectStatus.NOT_FOUND_REWRITE },
      ],
    });

    /** SSR v2 */
    (this.app.node.defaultChild as cdk.CfnResource).addPropertyOverride('Platform', 'WEB_COMPUTE');

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
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.resolve(__dirname, 'cr-import-repo'), {
        bundling: {
          image: cdk.DockerImage.fromRegistry('public.ecr.aws/sam/build-python3.12:latest-x86_64'),
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
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.gibibytes(3),
      timeout: cdk.Duration.minutes(15),
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
