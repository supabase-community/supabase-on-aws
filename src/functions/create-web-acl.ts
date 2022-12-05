import { WAFV2Client, CreateWebACLCommand, UpdateWebACLCommand, DeleteWebACLCommand, GetWebACLCommand, Rule } from '@aws-sdk/client-wafv2';
import { fromUtf8 } from '@aws-sdk/util-utf8-node';
import { CdkCustomResourceHandler } from 'aws-lambda';

const defaultRules: Rule[] = [
  {
    Name: 'AWS-AWSManagedRulesAmazonIpReputationList',
    Priority: 0,
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: 'AWS',
        Name: 'AWSManagedRulesAmazonIpReputationList',
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
    },
    OverrideAction: { None: {} },
  },
  {
    Name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
    Priority: 1,
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: 'AWS',
        Name: 'AWSManagedRulesKnownBadInputsRuleSet',
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
    },
    OverrideAction: { None: {} },
  },
  {
    Name: 'AWS-AWSManagedRulesBotControlRuleSet',
    Priority: 2,
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: 'AWS',
        Name: 'AWSManagedRulesBotControlRuleSet',
        ExcludedRules: [
          { Name: 'CategoryHttpLibrary' },
          { Name: 'SignalNonBrowserUserAgent' },
        ],
        ScopeDownStatement: {
          NotStatement: {
            Statement: {
              ByteMatchStatement: {
                FieldToMatch: { UriPath: {} },
                PositionalConstraint: 'STARTS_WITH',
                SearchString: fromUtf8('/pg/'),
                TextTransformations: [{ Priority: 0, Type: 'NONE' }],
              },
            },
          },
        },
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: 'AWS-AWSManagedRulesBotControlRuleSet',
    },
    OverrideAction: { None: {} },
  },
  {
    Name: 'AWS-AWSManagedRulesATPRuleSet',
    Priority: 3,
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: 'AWS',
        Name: 'AWSManagedRulesATPRuleSet',
        ExcludedRules: [
          { Name: 'SignalMissingCredential' },
        ],
        ManagedRuleGroupConfigs: [
          { LoginPath: '/auth/v1/token' },
          { PayloadType: 'JSON' },
          { UsernameField: { Identifier: '/email' } },
          { PasswordField: { Identifier: '/password' } },
        ],
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: 'AWS-AWSManagedRulesATPRuleSet',
    },
    OverrideAction: { None: {} },
  },
  {
    Name: 'RateBasedRule',
    Priority: 4,
    Statement: {
      RateBasedStatement: {
        Limit: 5 * 60 * 100, // 100req/s
        AggregateKeyType: 'IP',
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: 'RateBasedRule',
    },
    Action: { Block: {} },
  },
];

const client = new WAFV2Client({ region: 'us-east-1' });

const getWebAcl = async (id: string, name: string) => {
  const cmd = new GetWebACLCommand({ Id: id, Name: name, Scope: 'CLOUDFRONT' });
  const output = await client.send(cmd);
  return output;
};

const createWebAcl = async (name: string, description?: string) => {
  const cmd = new CreateWebACLCommand({
    Name: name,
    Description: description,
    Scope: 'CLOUDFRONT',
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: name,
    },
    DefaultAction: { Allow: {} },
    Rules: defaultRules,
  });
  const { Summary: webAcl } = await client.send(cmd);
  return webAcl!;
};

const updateWebAcl = async (id: string, name: string, description?: string) => {
  const { LockToken, WebACL: webAcl } = await getWebAcl(id, name);
  const cmd = new UpdateWebACLCommand({
    LockToken,
    Id: id,
    Name: name,
    Description: description,
    Scope: 'CLOUDFRONT',
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: name,
    },
    DefaultAction: { Allow: {} },
    Rules: defaultRules,
  });
  const { NextLockToken } = await client.send(cmd);
  return webAcl!;
};

const deleteWebAcl = async (id: string, name: string) => {
  const { LockToken } = await getWebAcl(id, name);
  const cmd = new DeleteWebACLCommand({ Id: id, Name: name, Scope: 'CLOUDFRONT', LockToken });
  await client.send(cmd);
};

const parsePhysicalResourceId = (physicalResourceId: string) => {
  // e.g. my-webacl-name|1234a1a-a1b1-12a1-abcd-a123b123456|CLOUDFRONT
  const [name, id, scope] = physicalResourceId.split('|');
  return { name, id, scope };
};

const arnToPhysicalResourceId = (arn: string) => {
  const [arnScope, arnType, name, id] = arn.split(':')[5].split('/');
  const scope = (arnScope == 'global') ? 'CLOUDFRONT' : 'REGIONAL';
  return [name, id, scope].join('|');
};

interface CustomResourceProperties {
  ServiceToken: string;
  Name: string;
  Description?: string;
  Fingerprint: string;
}

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const hash = event.RequestId.split('-')[0];
  const props = event.ResourceProperties as CustomResourceProperties;

  switch (event.RequestType) {
    case 'Create': {
      const webAcl = await createWebAcl(`${props.Name}-${hash}`, props.Description);
      return {
        PhysicalResourceId: arnToPhysicalResourceId(webAcl.ARN!),
        Data: { Arn: webAcl.ARN, Id: webAcl.Id, Name: webAcl.Name },
      };
    }
    case 'Update': {
      const { id, name } = parsePhysicalResourceId(event.PhysicalResourceId);
      const oldProps = event.OldResourceProperties as CustomResourceProperties;
      const webAcl = (props.Name == oldProps.Name)
        ? await updateWebAcl(id, name, props.Description)
        : await createWebAcl(`${props.Name}-${hash}`, props.Description);
      return {
        PhysicalResourceId: arnToPhysicalResourceId(webAcl.ARN!),
        Data: { Arn: webAcl.ARN, Id: webAcl.Id, Name: webAcl.Name },
      };
    }
    case 'Delete': {
      const { name, id } = parsePhysicalResourceId(event.PhysicalResourceId);
      await deleteWebAcl(id, name);
      return {};
    }
  };
};