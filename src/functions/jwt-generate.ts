import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';
import jwt from 'jsonwebtoken';

const region = process.env.AWS_REGION;
const issuer = 'supabase';
const expiresIn = '10y';

const client = new SecretsManagerClient({ region });

interface jwtSecret {
  jwt_secret: string;
  anon_key?: string;
  service_role_key?: string;
};

const getSecret = async (secretId: string) => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const secret = JSON.parse(SecretString!) as jwtSecret;
  console.log('Get secret successfully.');
  return secret;
};

const generateJwt = async (secretId: string) => {
  const secret = await getSecret(secretId);

  const anonKey = jwt.sign({ role: 'anon' }, secret.jwt_secret, { issuer, expiresIn });
  const serviceRoleKey = jwt.sign({ role: 'service_role' }, secret.jwt_secret, { issuer, expiresIn });

  const newSecret: jwtSecret ={
    jwt_secret: secret.jwt_secret,
    anon_key: anonKey,
    service_role_key: serviceRoleKey,
  };

  const cmd = new UpdateSecretCommand({
    SecretId: secretId,
    SecretString: JSON.stringify(newSecret),
  });

  await client.send(cmd);
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const secretId: string = event.ResourceProperties.SecretId;
  const response: CdkCustomResourceResponse = { PhysicalResourceId: `${secretId}/ANON_KEY` };

  switch (event.RequestType) {
    case 'Create': {
      await generateJwt(secretId);
      return response;
    }
    case 'Update': {
      await generateJwt(secretId);
      return response;
    }
    case 'Delete': {
      return response;
    }
  };
};