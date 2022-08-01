import { WorkMailClient, DescribeOrganizationCommand } from '@aws-sdk/client-workmail';
import { CdkCustomResourceIsCompleteHandler, CdkCustomResourceIsCompleteResponse } from 'aws-lambda';

const checkOrganizationState = async (region: string, organizationId?: string): Promise<CdkCustomResourceIsCompleteResponse> => {
  const client = new WorkMailClient({ region });
  const cmd = new DescribeOrganizationCommand({ OrganizationId: organizationId });
  try {
    const { State } = await client.send(cmd);
    if (State == 'Active') {
      return { IsComplete: true };
    } else {
      return { IsComplete: false };
    }
  } catch (err) {
    return { IsComplete: false };
  } finally {
    client.destroy();
  }
};

export const handler: CdkCustomResourceIsCompleteHandler = async (event, _context) => {
  const region: string = event.ResourceProperties.Region;
  const organizationId = event.PhysicalResourceId;
  switch (event.RequestType) {
    case 'Create': {
      return checkOrganizationState(region, organizationId);
    }
    case 'Update': {
      return checkOrganizationState(region, organizationId);
    }
    default : {
      return { IsComplete: true };
    }
  }
};