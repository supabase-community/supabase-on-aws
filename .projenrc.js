const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  projenVersion: '0.70.5',
  cdkVersion: '2.108.0',
  defaultReleaseBranch: 'main',
  name: 'supabase-on-aws',
  description: 'Self-hosted Supabase on AWS',
  deps: [
    // AWS CDK
    '@aws-cdk/aws-amplify-alpha',
    '@aws-cdk/aws-apigatewayv2-alpha',
    '@aws-cdk/aws-apigatewayv2-integrations-alpha',
    // Lambda Powertools
    '@aws-lambda-powertools/logger@1.16.0',
    '@aws-lambda-powertools/tracer@1.16.0',
    // AWS SDK
    '@aws-sdk/client-cloudfront',
    '@aws-sdk/client-ecs',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sqs',
    '@aws-sdk/client-ssm',
    '@aws-sdk/client-wafv2',
    '@aws-sdk/client-workmail',
    '@aws-sdk/util-utf8-node',
    // Others
    '@databases/pg',
    '@types/aws-lambda',
    'cdk-bootstrapless-synthesizer@^2.2.2',
    'hono@^3.2.6',
    'jsonwebtoken@^8.5.1',
    'utf8',
  ],
  devDeps: [
    '@types/jsonwebtoken',
    '@types/utf8',
  ],
  tsconfig: {
    compilerOptions: {
      noUnusedLocals: false,
      noUnusedParameters: false,
    },
  },
  gitignore: [
    'cdk.context.json',
  ],
  buildWorkflow: false, // Todo: fix db-init function assets key
  depsUpgrade: false,
});
project.synth();