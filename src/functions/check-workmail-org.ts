import { SESClient, GetIdentityVerificationAttributesCommand } from '@aws-sdk/client-ses';
import { WorkMailClient, DescribeOrganizationCommand } from '@aws-sdk/client-workmail';
import { CdkCustomResourceIsCompleteHandler, CdkCustomResourceIsCompleteResponse } from 'aws-lambda';

const checkVerificationStatus = async (region: string, identity: string): Promise<boolean> => {
  const client = new SESClient({ region });
  const cmd = new GetIdentityVerificationAttributesCommand({ Identities: [identity] });
  const { VerificationAttributes } = await client.send(cmd);
  client.destroy();
  const verificationStatus = VerificationAttributes?.[identity].VerificationStatus;
  if (verificationStatus == 'Success') {
    return true;
  } else {
    return false;
  }
};

const checkOrganizationState = async (region: string, organizationId?: string): Promise<CdkCustomResourceIsCompleteResponse> => {
  const client = new WorkMailClient({ region });
  const cmd = new DescribeOrganizationCommand({ OrganizationId: organizationId });
  const { State, Alias } = await client.send(cmd);
  client.destroy();
  if (State != 'Active') {
    return { IsComplete: false };
  } else {
    const sesIdentity = `${Alias}.awsapps.com`;
    const verificationStatus = await checkVerificationStatus(region, sesIdentity);
    if (verificationStatus) {
      return { IsComplete: true };
    } else {
      return { IsComplete: false };
    }
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