import { App } from 'aws-cdk-lib';
import { BootstraplessStackSynthesizer } from 'cdk-bootstrapless-synthesizer';
import { SupabaseStack } from './supabase-stack';

const isCfnPublishing: boolean = typeof process.env.BSS_FILE_ASSET_BUCKET_NAME != 'undefined';

const env = (isCfnPublishing)
  ? undefined
  : { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

const synthesizer = (isCfnPublishing)
  ? new BootstraplessStackSynthesizer()
  : undefined;

const app = new App();

new SupabaseStack(app, 'Supabase', { env, synthesizer, meshEnabled: true, gqlEnabled: false });

app.synth();