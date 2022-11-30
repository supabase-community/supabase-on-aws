const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.53.0',
  defaultReleaseBranch: 'main',
  name: 'supabase-on-aws',
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  deps: [
    '@aws-cdk/aws-amplify-alpha',
    '@aws-cdk/aws-apigatewayv2-alpha',
    '@aws-cdk/aws-apigatewayv2-integrations-alpha',
    '@aws-sdk/client-ecs',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-ses',
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
});
project.synth();