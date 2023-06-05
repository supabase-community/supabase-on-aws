import * as fs from 'fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import connect, { sql, ConnectionPool } from '@databases/pg';
import { CdkCustomResourceHandler } from 'aws-lambda';

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

const dbSecretArn = process.env.DB_SECRET_ARN!;

/** API Client for Secrets Manager */
const secretsManager = new SecretsManagerClient({});

/** Get secret from Secrets Manager */
const getSecret = async (secretId: string): Promise<dbSecret> => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await secretsManager.send(cmd);
  const secret = JSON.parse(SecretString!) as dbSecret;
  return secret;
};

/** Run queries under the directory */
const runQueries = async (db: ConnectionPool, dir: string) => {
  /** SQL files under the directory */
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql'));

  for await (let file of files) {
    const query = sql.file(`${dir}${file}`);
    try {
      console.info(`Run: ${file}`);
      const result = await db.query(query);
      if (result.length > 0) {
        console.info(result);
      }
    } catch (err: any) {
      console.error(err);
    }
  }
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  /** The secret used for database connections */
  const dbSecret = await getSecret(dbSecretArn);
  const { host, port, dbname, username: rootUsername, password: rootPassword } = dbSecret;

  /** Database connection */
  const db = connect({
    host,
    port: Number(port),
    user: rootUsername,
    password: rootPassword,
    database: dbname || 'postgres',
    ssl: 'disable',
  });
  console.info('Connected to PostgreSQL database');

  switch (event.RequestType) {
    case 'Create': {
      await runQueries(db, './init-for-rds/');
      await runQueries(db, './init-scripts/');
      await runQueries(db, './migrations/');
      break;
    }
    case 'Update': {
      await runQueries(db, './init-for-rds/');
      await runQueries(db, './init-scripts/');
      await runQueries(db, './migrations/');
      break;
    }
    case 'Delete': {
      break;
    }
  };

  await db.dispose();
  return {};
};