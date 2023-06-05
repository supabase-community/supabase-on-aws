import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
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

/** Put secret to Secrets Manager */
const putSecret = async (secretId: string, SecretValue: object) => {
  const cmd = new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(SecretValue) });
  await secretsManager.send(cmd);
};

/** Escape a parameter for DDL */
const raw = (text: string) => sql.__dangerous__rawValue(text);

/** Set password */
const setUserPassword = async (db: ConnectionPool, username: string, password: string) => {
  await db.query(sql`ALTER USER ${raw(username)} WITH PASSWORD '${raw(password)}'`);
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  /** The name of user to be created or droped */
  const username: string = event.ResourceProperties.Username;
  /** The secret of user to be created */
  const secretId: string = event.ResourceProperties.SecretId;

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
  console.log('Connected to PostgreSQL database');

  let physicalResourceId: string|undefined

  switch (event.RequestType) {
    case 'Create': {
      const { password } = await getSecret(secretId);
      await setUserPassword(db, username, password);
      await putSecret(secretId, {
        ...dbSecret,
        username,
        password,
        uri: `postgres://${username}:${password}@${host}:${port}/${dbname}`,
      });
      physicalResourceId = `${username}@${dbSecret.host}`;
      break;
    }
    case 'Update': {
      const { password } = await getSecret(secretId);
      await setUserPassword(db, username, password);
      await putSecret(secretId, {
        ...dbSecret,
        username,
        password,
        uri: `postgres://${username}:${password}@${host}:${port}/${dbname}`,
      });
      physicalResourceId = `${username}@${dbSecret.host}`;
      break;
    }
    case 'Delete': {
      break;
    }
  };

  await db.dispose();
  return { PhysicalResourceId: physicalResourceId };
};