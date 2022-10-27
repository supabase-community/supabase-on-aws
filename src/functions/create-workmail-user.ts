import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { WorkMailClient, CreateUserCommand, DeleteUserCommand, RegisterToWorkMailCommand, DeregisterFromWorkMailCommand, DescribeOrganizationCommand } from '@aws-sdk/client-workmail';
import { CdkCustomResourceHandler } from 'aws-lambda';

interface WorkMailUserSecret {
  username: string;
  password: string;
}

const getSecretValue = async (secretId: string) => {
  const client = new SecretsManagerClient({});
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const value: WorkMailUserSecret = JSON.parse(SecretString!);
  return value;
};

const describeMailDomain = async (region: string, organizationId: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new DescribeOrganizationCommand({ OrganizationId: organizationId });
  const { DefaultMailDomain } = await client.send(cmd);
  client.destroy();
  return DefaultMailDomain!;
};

const registerToWorkMail = async (region: string, organizationId: string, entityId: string, email: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new RegisterToWorkMailCommand({
    OrganizationId: organizationId,
    EntityId: entityId,
    Email: email,
  });
  await client.send(cmd);
  client.destroy();
};

const deregisterFromWorkMail = async (region: string, organizationId: string, entityId: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new DeregisterFromWorkMailCommand({
    OrganizationId: organizationId,
    EntityId: entityId,
  });
  await client.send(cmd);
  client.destroy();
};

const createUser = async (region: string, organizationId: string, secretId: string, displayName: string) => {
  const mailDomain = await describeMailDomain(region, organizationId);
  const email = `${displayName.toLowerCase()}@${mailDomain}`;
  const { username, password } = await getSecretValue(secretId);
  const client = new WorkMailClient({ region });
  const cmd = new CreateUserCommand({
    OrganizationId: organizationId,
    Name: username,
    Password: password,
    DisplayName: displayName,
  });
  const output = await client.send(cmd);
  const userId = output.UserId!;
  await registerToWorkMail(region, organizationId, userId, email);
  client.destroy();
  return { userId, email };
};

const deleteUser = async (region: string, organizationId: string, userId: string) => {
  const client = new WorkMailClient({ region });
  try {
    await deregisterFromWorkMail(region, organizationId, userId);
    const cmd = new DeleteUserCommand({
      OrganizationId: organizationId,
      UserId: userId,
    });
    await client.send(cmd);
  } catch (err) {
    console.error(err);
  } finally {
    client.destroy();
  }
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const region: string = event.ResourceProperties.Region;
  const organizationId: string = event.ResourceProperties.OrganizationId;
  const secretId: string = event.ResourceProperties.SecretId;
  const displayName: string = event.ResourceProperties.DisplayName;

  switch (event.RequestType) {
    case 'Create': {
      const user = await createUser(region, organizationId, secretId, displayName);
      return { PhysicalResourceId: user.email, Data: { UserId: user.userId, Email: user.email } };
    }
    case 'Update': {
      const oldUserId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, oldUserId);
      const user = await createUser(region, organizationId, secretId, displayName);
      return { PhysicalResourceId: user.email, Data: { UserId: user.userId, Email: user.email } };
    }
    case 'Delete': {
      const userId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, userId);
      return {};
    }
  };
};