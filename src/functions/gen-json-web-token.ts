import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';
import jwt from 'jsonwebtoken';

const region = process.env.AWS_REGION;
const jwtSecretArn = process.env.JWT_SECRET_ARN!;

interface Payload extends Object {
  role: string;
}

const getJwtSecret = async (secretId: string) => {
  const client = new SecretsManagerClient({ region });
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  console.log('Get secret successfully.');
  client.destroy();
  return SecretString!;
};

const generateToken = async (payload: object, secretId: string, issuer?: string, expiresIn?: string) => {
  const jwtSecret = await getJwtSecret(secretId);
  const token = jwt.sign(payload, jwtSecret, { issuer, expiresIn });
  return token;
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const payload: Payload = event.ResourceProperties.Payload;
  const role = payload.role;
  const issuer: string|undefined = event.ResourceProperties.Issuer;
  const expiresIn: string|undefined = event.ResourceProperties.ExpiresIn;

  switch (event.RequestType) {
    case 'Create': {
      const token = await generateToken(payload, jwtSecretArn, issuer, expiresIn);
      const response: CdkCustomResourceResponse = {
        PhysicalResourceId: `Supabase/API/Role/${role}`,
        Data: { Token: token, Role: role, Issuer: issuer },
      };
      return response;
    }
    case 'Update': {
      const token = await generateToken(payload, jwtSecretArn, issuer, expiresIn);
      const response: CdkCustomResourceResponse = {
        PhysicalResourceId: `Supabase/API/Role/${role}`,
        Data: { Token: token, Role: role, Issuer: issuer },
      };
      return response;
    }
    case 'Delete': {
      return {};
    }
  };
};