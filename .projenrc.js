const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.35.0',
  defaultReleaseBranch: 'main',
  name: 'supabase-on-aws',
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  deps: [
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-ses',
    '@aws-sdk/client-workmail',
    '@databases/pg',
    '@types/aws-lambda',
    'jsonwebtoken@^8.5.1',
  ],
  devDeps: [
    '@types/jsonwebtoken',
  ],
  tsconfig: {
    compilerOptions: {
      noUnusedLocals: false,
      noUnusedParameters: false,
    },
  },
});
project.synth();