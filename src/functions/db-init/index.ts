import * as fs from 'fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import createConnectionPool, { sql, ConnectionPoolConfig } from '@databases/pg';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';

interface dbSecret {
  engine: string;
  host: string;
  port: string;
  username: string;
  password: string;
  dbClusterIdentifier?: string;
  dbInstanceIdentifier?: string;
};

const getConfig = async (secretId: string): Promise<ConnectionPoolConfig> => {
  const client = new SecretsManagerClient({});
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const secret = JSON.parse(SecretString!) as dbSecret;
  console.log('Get secret successfully.');
  const config: ConnectionPoolConfig = {
    host: secret.host,
    port: Number(secret.port),
    user: secret.username,
    password: secret.password,
    ssl: 'disable',
  };
  return config;
};

const initialize = async (secretId: string) => {
  const config = await getConfig(secretId);
  const db = createConnectionPool(config);
  console.log('Connected to PostgreSQL database');

  try {

    await db.query(sql.file('./jwt-utils.sql'));
    await db.query(sql.file('./00-initial-schema.sql'));
    await db.query(sql.file('./01-auth-schema.sql'));
    await db.query(sql.file('./02-storage-schema.sql'));
    await db.query(sql.file('./03-post-setup.sql'));

  } catch (err) {
    console.error(err);
  } finally {
    await db.dispose();
  }
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const secretId: string = event.ResourceProperties.SecretId;
  const response: CdkCustomResourceResponse = {};

  switch (event.RequestType) {
    case 'Create': {
      await initialize(secretId);
      return response;
    }
    case 'Update': {
      await initialize(secretId);
      return response;
    }
    case 'Delete': {
      return response;
    }
  };
};