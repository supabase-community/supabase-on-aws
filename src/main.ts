import { App } from 'aws-cdk-lib';
import { SupabaseStack } from './supabase-stack';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new SupabaseStack(app, 'Supabase', { env });

app.synth();