import * as cdk from 'aws-cdk-lib';

import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface ManagedPrefixListProps {
  name: string;
}

export class ManagedPrefixList extends cr.AwsCustomResource {

  constructor(scope: Construct, id: string, props: ManagedPrefixListProps) {
    super(scope, id, {
      resourceType: 'Custom::ManagedPrefixList',
      //functionName: 'LookupManagedPrefixList',
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      onCreate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [{ Name: 'prefix-list-name', Values: [props.name] }],
        },
        //outputPaths: ['PrefixLists.0'],
        physicalResourceId: cr.PhysicalResourceId.fromResponse('PrefixLists.0.PrefixListId'),
      },
    });

  }
}
