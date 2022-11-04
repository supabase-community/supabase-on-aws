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
  let secretString: string;
  try {
    const output = await client.send(cmd);
    secretString = output.SecretString!;
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    client.destroy();
  }
  const value: WorkMailUserSecret = JSON.parse(secretString);
  return value;
};

const describeMailDomain = async (region: string, organizationId: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new DescribeOrganizationCommand({ OrganizationId: organizationId });
  let mailDomain: string;
  try {
    const output = await client.send(cmd);
    mailDomain = output.DefaultMailDomain!;
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    client.destroy();
  }
  return mailDomain;
};

const registerToWorkMail = async (region: string, organizationId: string, entityId: string, email: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new RegisterToWorkMailCommand({
    OrganizationId: organizationId,
    EntityId: entityId,
    Email: email,
  });
  try {
    await client.send(cmd);
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    client.destroy();
  }
};

const deregisterFromWorkMail = async (region: string, organizationId: string, entityId: string) => {
  const client = new WorkMailClient({ region });
  const cmd = new DeregisterFromWorkMailCommand({
    OrganizationId: organizationId,
    EntityId: entityId,
  });
  try {
    await client.send(cmd);
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    client.destroy();
  }
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
  let userId: string;
  try {
    const output = await client.send(cmd);
    userId = output.UserId!;
  } catch (err) {
    console.error(err);
    throw err;
  } finally {
    client.destroy();
  }
  await registerToWorkMail(region, organizationId, userId, email);
  return { userId, email };
};

const deleteUser = async (region: string, organizationId: string, userId: string) => {
  const client = new WorkMailClient({ region });
  await deregisterFromWorkMail(region, organizationId, userId);
  const cmd = new DeleteUserCommand({
    OrganizationId: organizationId,
    UserId: userId,
  });
  try {
    await client.send(cmd);
  } catch (err) {
    console.error(err);
    throw err;
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
      return { PhysicalResourceId: user.userId, Data: { UserId: user.userId, Email: user.email } };
    }
    case 'Update': {
      const oldUserId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, oldUserId);
      const user = await createUser(region, organizationId, secretId, displayName);
      return { PhysicalResourceId: user.userId, Data: { UserId: user.userId, Email: user.email } };
    }
    case 'Delete': {
      const userId = event.PhysicalResourceId;
      await deleteUser(region, organizationId, userId);
      return {};
    }
  };
};