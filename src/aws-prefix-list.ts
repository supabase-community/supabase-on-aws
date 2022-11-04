import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface PrefixListProps {
  prefixListName: string;
}

export class PrefixList extends cr.AwsCustomResource {
  prefixListId: string;

  constructor(scope: Construct, id: string, props: PrefixListProps) {
    super(scope, id, {
      resourceType: 'Custom::PrefixList',
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      onCreate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [{ Name: 'prefix-list-name', Values: [props.prefixListName] }],
        },
        //outputPaths: ['PrefixLists.0'],
        physicalResourceId: cr.PhysicalResourceId.fromResponse('PrefixLists.0.PrefixListId'),
      },
    });

    this.prefixListId = this.getResponseField('PrefixLists.0.PrefixListId');
  }
}
