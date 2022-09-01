import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SupabaseStack } from '../src/supabase-stack';

const pjPrefix = 'Supabase';

test('Snapshot', () => {
  const app = new App();
  const stack = new SupabaseStack(app, `${pjPrefix}-stack`, { meshEnabled: true, gqlEnabled: false });
  const withoutMesh = new SupabaseStack(app, `${pjPrefix}-without-mesh`, { meshEnabled: false, gqlEnabled: false });
  const graphql = new SupabaseStack(app, `${pjPrefix}-graphql`, { meshEnabled: true, gqlEnabled: true });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(Template.fromStack(withoutMesh)).toMatchSnapshot();
  expect(Template.fromStack(graphql)).toMatchSnapshot();
});