import * as fs from 'fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import createConnectionPool, { sql, ConnectionPoolConfig, ConnectionPool } from '@databases/pg';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';

interface dbSecret {
  engine: string;
  host: string;
  port: string;
  username: string;
  password: string;
  dbname?: string;
  dbClusterIdentifier?: string;
  dbInstanceIdentifier?: string;
}

export const getConfig = async (secretId: string): Promise<ConnectionPoolConfig> => {
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
    database: secret.dbname || 'postgres',
    ssl: 'disable',
    onQueryError: (_query, { text }, err) => {
      console.error(`${new Date().toISOString()} ERROR QUERY ${text} - ${err.message}`);
    },
    bigIntMode: 'bigint',
  };
  return config;
};

export const listFile = (dir: string, suffix: string) => {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(suffix));
  return files.map((file) => `${dir}${file}`);
};

export const runSQLFiles = async (files: string[], db: ConnectionPool) => {
  for await (let file of files) {
    console.log(`${file} ----- start query`);
    try {
      const result = await db.query(sql.file(file));
      if (result.length > 0) {
        console.info(result);
      }
    } catch (err) {
      console.error(err);
    } finally {
      console.log(`${file} ----- end query`);
    }
  }
};

const initialize = async (secretId: string, host: string) => {
  const config = await getConfig(secretId);
  const db = createConnectionPool({ ...config, host });
  console.log('Connected to PostgreSQL database');

  const files = listFile('./', '.sql');
  await runSQLFiles(files, db);

  await db.dispose();
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const secretId: string = event.ResourceProperties.SecretId;
  const hostname: string = event.ResourceProperties.Hostname;
  const response: CdkCustomResourceResponse = {};

  switch (event.RequestType) {
    case 'Create': {
      await initialize(secretId, hostname);
      return response;
    }
    case 'Update': {
      await initialize(secretId, hostname);
      return response;
    }
    case 'Delete': {
      return response;
    }
  }
};
