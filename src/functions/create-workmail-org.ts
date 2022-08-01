import { WorkMailClient, CreateOrganizationCommand, DeleteOrganizationCommand } from '@aws-sdk/client-workmail';
import { CdkCustomResourceHandler } from 'aws-lambda';

const createOrg = async (region: string, alias: string, domainName?: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new CreateOrganizationCommand({
    Alias: alias,
    Domains: (typeof domainName == 'undefined') ? undefined : [{ DomainName: domainName }],
  });
  try {
    const output = await client.send(cmd);
    return output;
  } catch (err) {
    throw err;
  } finally {
    client.destroy();
  }
};

const deleteOrg = async (region: string, organizationId: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new DeleteOrganizationCommand({ OrganizationId: organizationId, DeleteDirectory: true });
  try {
    await client.send(cmd);
    return;
  } catch (err) {
    console.warn(err);
  } finally {
    client.destroy();
  }
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const region: string = event.ResourceProperties.Region;
  const alias: string = event.ResourceProperties.Alias;
  const domainName: string|undefined = event.ResourceProperties.DomainName;

  switch (event.RequestType) {
    case 'Create': {
      const output = await createOrg(region, alias, domainName);
      return { PhysicalResourceId: output.OrganizationId, Data: output };
    }
    case 'Update': {
      const oldOrgId: string = event.PhysicalResourceId;
      const output = await createOrg(region, alias, domainName);
      await deleteOrg(region, oldOrgId);
      return { PhysicalResourceId: output.OrganizationId, Data: output };
    }
    case 'Delete': {
      const oldOrgId: string = event.PhysicalResourceId;
      await deleteOrg(region, oldOrgId);
      return {};
    }
  };
};