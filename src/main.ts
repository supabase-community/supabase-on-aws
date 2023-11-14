import { App } from 'aws-cdk-lib';
import { BootstraplessStackSynthesizer } from 'cdk-bootstrapless-synthesizer';
import { SupabaseStack } from './supabase-stack';
import { SupabaseWafStack } from './supabase-waf-stack';

const isCfnPublishing: boolean = typeof process.env.BSS_FILE_ASSET_BUCKET_NAME != 'undefined';

const env = (isCfnPublishing)
  ? undefined
  : { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

const synthesizer = (isCfnPublishing)
  ? new BootstraplessStackSynthesizer()
  : undefined;

const app = new App();

new SupabaseWafStack(app, 'SupabaseWaf', { env: { region: 'us-east-1' } });

new SupabaseStack(app, 'Supabase', { env, synthesizer });

app.synth();