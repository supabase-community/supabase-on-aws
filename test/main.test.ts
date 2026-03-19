import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Template } from 'aws-cdk-lib/assertions';
import { SupabaseStack } from '../src/supabase-stack';

test('Snapshot', () => {
  const app = new cdk.App();

  // Create mock VPC and DB resources for testing
  const helperStack = new cdk.Stack(app, 'Helper', {
    env: { account: '123456789012', region: 'us-east-1' },
  });

  const vpc = new ec2.Vpc(helperStack, 'TestVpc', { natGateways: 1 });
  const dbSg = new ec2.SecurityGroup(helperStack, 'DbSg', { vpc });
  const dbSecret = new secretsmanager.Secret(helperStack, 'DbSecret', {
    generateSecretString: {
      secretStringTemplate: JSON.stringify({
        username: 'supabase_admin',
        dbname: 'postgres',
      }),
      generateStringKey: 'password',
    },
  });

  const testStack = new SupabaseStack(app, 'Supabase', {
    env: { account: '123456789012', region: 'us-east-1' },
    vpc,
    databaseEndpoint: { hostname: 'test-db.cluster-abc.us-east-1.rds.amazonaws.com', port: 5432 },
    databaseAdminSecret: dbSecret,
    databaseSecurityGroup: dbSg,
  });

  expect(Template.fromStack(testStack)).toMatchSnapshot();
});
