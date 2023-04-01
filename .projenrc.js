const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  projenVersion: '0.70.5',
  cdkVersion: '2.72.0',
  defaultReleaseBranch: 'main',
  name: 'supabase-on-aws',
  description: 'Self-hosted Supabase on AWS',
  deps: [
    '@aws-cdk/aws-amplify-alpha',
    '@aws-cdk/aws-apigatewayv2-alpha',
    '@aws-cdk/aws-apigatewayv2-integrations-alpha',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/tracer',
    '@aws-sdk/client-cloudfront',
    '@aws-sdk/client-ecs',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sqs',
    '@aws-sdk/client-ssm',
    '@aws-sdk/client-wafv2',
    '@aws-sdk/client-workmail',
    '@aws-sdk/util-utf8-node',
    '@databases/pg',
    '@types/aws-lambda',
    'cdk-bootstrapless-synthesizer@^2.2.2',
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