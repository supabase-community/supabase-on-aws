import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SupabaseStack } from '../src/supabase-stack';

test('Snapshot', () => {
  const app = new App();

  const testStack = new SupabaseStack(app, 'Supabase');

  expect(Template.fromStack(testStack)).toMatchSnapshot();
});