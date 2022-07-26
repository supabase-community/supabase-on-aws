const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.33.0',
  defaultReleaseBranch: 'main',
  name: 'supabase-on-aws',
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  deps: [
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