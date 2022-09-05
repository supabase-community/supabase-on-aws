import { WAFV2Client, CreateWebACLCommand, UpdateWebACLCommand, DeleteWebACLCommand, GetWebACLCommand, CreateWebACLCommandInput } from '@aws-sdk/client-wafv2';
import { fromUtf8 } from '@aws-sdk/util-utf8-node';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';

const client = new WAFV2Client({ region: 'us-east-1' });

const getWebAcl = async (name: string, id: string, scope: string = 'CLOUDFRONT') => {
  const cmd = new GetWebACLCommand({ Id: id, Name: name, Scope: scope });
  const output = await client.send(cmd);
  return output;
};

const createWebAcl = async (props: CreateWebACLCommandInput): Promise<CdkCustomResourceResponse> => {
  const cmd = new CreateWebACLCommand(props);
  const { Summary: webAcl } = await client.send(cmd);
  const res = {
    PhysicalResourceId: `${webAcl?.Name}|${webAcl?.Id}|${props.Scope}`,
    Data: { Arn: webAcl?.ARN, Id: webAcl?.Id, Name: webAcl?.Name },
  };
  return res;
};

const updateWebAcl = async (name: string, id: string, props: CreateWebACLCommandInput): Promise<CdkCustomResourceResponse> => {
  const { LockToken, WebACL: webAcl } = await getWebAcl(name, id, props.Scope);
  const cmd = new UpdateWebACLCommand({ ...props, Name: name, Id: id, LockToken });
  await client.send(cmd);
  const res = {
    PhysicalResourceId: `${webAcl?.Name}|${webAcl?.Id}|${props.Scope}`,
    Data: { Arn: webAcl?.ARN, Id: webAcl?.Id, Name: webAcl?.Name },
  };
  return res;
};

const deleteWebAcl = async (name: string, id: string, scope: string = 'CLOUDFRONT'): Promise<CdkCustomResourceResponse> => {
  const { LockToken } = await getWebAcl(name, id);
  const cmd = new DeleteWebACLCommand({ Name: name, Id: id, Scope: scope, LockToken });
  try {
    await client.send(cmd);
  } catch (err) {
    console.warn(err);
  } finally {
    return {
      PhysicalResourceId: `${name}|${id}|${scope}`,
    };
  }
};

const parsePhysicalResourceId = (physicalResourceId: string) => {
  // e.g. my-webacl-name|1234a1a-a1b1-12a1-abcd-a123b123456|CLOUDFRONT
  const [name, id, scope] = physicalResourceId.split('|');
  return { name, id, scope };
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const props = event.ResourceProperties as CreateWebACLCommandInput & { Name: string; ServiceToken: string };
  console.log(JSON.stringify(props));
  props.Rules?.map(rule => {
    rule.Priority = Number(rule.Priority);
    if (typeof rule.Statement?.RateBasedStatement != 'undefined') {
      rule.Statement.RateBasedStatement.Limit = Number(rule.Statement.RateBasedStatement.Limit);
    }
    // for Supabase Studio SSR
    if (typeof rule.Statement?.ManagedRuleGroupStatement != 'undefined' && rule.Statement.ManagedRuleGroupStatement.Name == 'AWSManagedRulesBotControlRuleSet') {
      rule.Statement.ManagedRuleGroupStatement.ScopeDownStatement = {
        NotStatement: {
          Statement: {
            ByteMatchStatement: {
              SearchString: fromUtf8('node-fetch'),
              FieldToMatch: {
                SingleHeader: { Name: 'user-agent' },
              },
              TextTransformations: [{ Priority: 0, Type: 'NONE' }],
              PositionalConstraint: 'STARTS_WITH',
            },
          },
        },
      };
    };
    //if (typeof rule.Statement?.ManagedRuleGroupStatement != 'undefined' && rule.Statement.ManagedRuleGroupStatement.Name == 'AWSManagedRulesATPRuleSet') {
    //  rule.Statement.ManagedRuleGroupStatement.ScopeDownStatement = {
    //    ByteMatchStatement: {
    //      SearchString: fromUtf8('password'),
    //      FieldToMatch: {
    //        SingleQueryArgument: { Name: 'grant_type' },
    //      },
    //      TextTransformations: [{ Priority: 0, Type: 'NONE' }],
    //      PositionalConstraint: 'EXACTLY',
    //    },
    //  };
    //};
  });

  switch (event.RequestType) {
    case 'Create': {
      const res = await createWebAcl(props);
      return res;
    }
    case 'Update': {
      let res: CdkCustomResourceResponse;
      const { name, id, scope } = parsePhysicalResourceId(event.PhysicalResourceId);
      if (props.Name == name) {
        res = await updateWebAcl(name, id, props);
      } else {
        res = await createWebAcl(props);
        await deleteWebAcl(name, id, scope);
      }
      return res;
    }
    case 'Delete': {
      const { name, id, scope } = parsePhysicalResourceId(event.PhysicalResourceId);
      const res = await deleteWebAcl(name, id, scope);
      return res;
    }
  };
};