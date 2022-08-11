import { App } from 'aws-cdk-lib';
import { BootstraplessStackSynthesizer } from 'cdk-bootstrapless-synthesizer';
import { SupabaseStack } from './supabase-stack';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
const synthesizer = (typeof process.env.BSS_TEMPLATE_BUCKET_NAME == 'undefined')
  ? undefined
  : new BootstraplessStackSynthesizer();

const app = new App();

new SupabaseStack(app, 'Supabase', { synthesizer });

app.synth();