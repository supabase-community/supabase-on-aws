import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { WorkMailClient, CreateUserCommand, DeleteUserCommand, RegisterToWorkMailCommand, DeregisterFromWorkMailCommand } from '@aws-sdk/client-workmail';
import { CdkCustomResourceHandler } from 'aws-lambda';

interface WorkMailUserSecret {
  username: string;
  password: string;
  email: string;
}

const getSecretValue = async (secretId: string) => {
  const client = new SecretsManagerClient({});
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const value: WorkMailUserSecret = JSON.parse(SecretString!);
  return value;
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

const createUser = async (region: string, organizationId: string, secretId: string) => {
  const { username, password, email } = await getSecretValue(secretId);
  const client = new WorkMailClient({ region });
  const cmd = new CreateUserCommand({
    OrganizationId: organizationId,
    Name: username,
    DisplayName: username,
    Password: password,
  });
  const { UserId: userId } = await client.send(cmd);
  await registerToWorkMail(region, organizationId, userId!, email);
  client.destroy();
  return userId;
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

  switch (event.RequestType) {
    case 'Create': {
      const userId = await createUser(region, organizationId, secretId);
      return { PhysicalResourceId: userId, Data: { UserId: userId } };
    }
    case 'Update': {
      const oldUserId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, oldUserId);
      const userId = await createUser(region, organizationId, secretId);
      return { PhysicalResourceId: userId, Data: { UserId: userId } };
    }
    case 'Delete': {
      const userId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, userId);
      return {};
    }
  };
};