import * as crypto from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';
import * as utf8 from 'utf8';

interface sesSecret {
  access_key: string;
  secret_access_key: string;
  username?: string;
  password?: string;
  host?: string;
};

export const sign = (key: string[], msg: string) => {
  const hmac = crypto.createHmac('sha256', Buffer.from(key.map((a) => a.charCodeAt(0)))).update(utf8.encode(msg)) as any;
  return hmac.digest('binary').toString().split('');
};

export const genSmtpPassword = (key: string, region: string) => {
  const date = '11111111';
  const service = 'ses';
  const terminal = 'aws4_request';
  const message = 'SendRawEmail';
  const versionInBytes = [0x04];

  let signature = sign(utf8.encode('AWS4' + key).split(''), date);
  signature = sign(signature, region);
  signature = sign(signature, service);
  signature = sign(signature, terminal);
  signature = sign(signature, message);

  const signatureAndVersion = versionInBytes.slice(); //copy of array

  signature.forEach((a: string) => signatureAndVersion.push(a.charCodeAt(0)));

  return Buffer.from(signatureAndVersion).toString('base64');
};

const client = new SecretsManagerClient({});

const getSecret = async (secretId: string) => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const secret = JSON.parse(SecretString!) as sesSecret;
  console.log('Get secret successfully.');
  return secret;
};

const updateSecret = async (secretId: string, region: string) => {
  const secret = await getSecret(secretId);
  const smtpPassword = genSmtpPassword(secret.secret_access_key, region);
  const cmd = new UpdateSecretCommand({
    SecretId: secretId,
    SecretString: JSON.stringify({
      ...secret,
      username: secret.access_key,
      password: smtpPassword,
      host: `email-smtp.${region}.amazonaws.com`,
    } as sesSecret),
  });
  await client.send(cmd);
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const secretId: string = event.ResourceProperties.SecretId;
  const region: string = event.ResourceProperties.Region;
  const response: CdkCustomResourceResponse = { PhysicalResourceId: `${secretId}/password` };

  switch (event.RequestType) {
    case 'Create': {
      await updateSecret(secretId, region);
      return response;
    }
    case 'Update': {
      await updateSecret(secretId, region);
      return response;
    }
    case 'Delete': {
      return response;
    }
  };
};