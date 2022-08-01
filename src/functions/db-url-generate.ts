import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';

const region = process.env.AWS_REGION;
const client = new SecretsManagerClient({ region });

interface dbSecret {
  engine: string;
  host: string;
  port: string;
  username: string;
  password: string;
  dbname?: string;
  dbClusterIdentifier?: string;
  dbInstanceIdentifier?: string;
};

const getSecret = async (secretId: string) => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const secret = JSON.parse(SecretString!) as dbSecret;
  console.log('Get secret successfully.');
  return secret;
};

const updateSecret = async (secretId: string) => {
  const secret = await getSecret(secretId);
  const dbname = secret.dbname || 'postgres';
  const newSecret = {
    ...secret,
    url: `postgres://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${dbname}`,
    url_auth: `postgres://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${dbname}?search_path=auth`,
  };
  const cmd = new UpdateSecretCommand({
    SecretId: secretId,
    SecretString: JSON.stringify(newSecret),
  });
  await client.send(cmd);
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const secretId: string = event.ResourceProperties.SecretId;
  const response: CdkCustomResourceResponse = { PhysicalResourceId: `${secretId}/url` };

  switch (event.RequestType) {
    case 'Create': {
      await updateSecret(secretId);
      return response;
    }
    case 'Update': {
      await updateSecret(secretId);
      return response;
    }
    case 'Delete': {
      return response;
    }
  };
};