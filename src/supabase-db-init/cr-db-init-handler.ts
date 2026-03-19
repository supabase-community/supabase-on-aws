import * as fs from 'fs';
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import connect, { sql, ConnectionPool } from '@databases/pg';
import { CdkCustomResourceHandler } from 'aws-lambda';

interface DbSecret {
  engine: string;
  host: string;
  port: string;
  username: string;
  password: string;
  dbname?: string;
}

interface UserSecretConfig {
  username: string;
  secretArn: string;
}

const dbSecretArn = process.env.DB_SECRET_ARN!;
const jwtSecretArn = process.env.JWT_SECRET_ARN!;
const jwtExp = process.env.JWT_EXP!;

const secretsManager = new SecretsManagerClient({});

const getSecret = async (secretId: string): Promise<any> => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await secretsManager.send(cmd);
  return JSON.parse(SecretString!);
};

const putSecret = async (secretId: string, secretValue: object) => {
  const cmd = new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(secretValue) });
  await secretsManager.send(cmd);
};

const raw = (text: string) => sql.__dangerous__rawValue(text);

const runSqlFiles = async (db: ConnectionPool, dir: string) => {
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    const query = sql.file(`${dir}/${file}`);
    try {
      console.info(`Run: ${file}`);
      const result = await db.query(query);
      if (result.length > 0) {
        console.info(result);
      }
    } catch (err: any) {
      console.error(`Error in ${file}:`, err.message);
    }
  }
};

const setUserPassword = async (db: ConnectionPool, username: string, password: string) => {
  await db.query(sql`ALTER USER ${raw(username)} WITH PASSWORD '${raw(password)}'`);
};

export const handler: CdkCustomResourceHandler = async (event, _context) => {
  const dbSecret: DbSecret = await getSecret(dbSecretArn);
  const { host, port, dbname, username: rootUsername, password: rootPassword } = dbSecret;

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
    case 'Create':
    case 'Update': {
      // Run initialization SQL scripts
      await runSqlFiles(db, './sql');

      // Set JWT settings
      const jwtSecret = await getSecret(jwtSecretArn);
      const jwtSecretValue = typeof jwtSecret === 'string' ? jwtSecret : jwtSecret.SecretString || JSON.stringify(jwtSecret);
      await db.query(sql`ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '${raw(jwtSecretValue)}'`);
      await db.query(sql`ALTER DATABASE postgres SET "app.settings.jwt_exp" TO '${raw(jwtExp)}'`);

      // Set user passwords from Secrets Manager and update secrets with connection URIs
      const userSecretsJson = process.env.USER_SECRETS || '[]';
      const userSecrets: UserSecretConfig[] = JSON.parse(userSecretsJson);

      for (const userConfig of userSecrets) {
        try {
          const userSecret = await getSecret(userConfig.secretArn);
          const password = userSecret.password;
          await setUserPassword(db, userConfig.username, password);
          await putSecret(userConfig.secretArn, {
            ...dbSecret,
            username: userConfig.username,
            password,
            uri: `postgres://${userConfig.username}:${encodeURIComponent(password)}@${host}:${port}/${dbname || 'postgres'}`,
          });
          console.info(`Set password for ${userConfig.username}`);
        } catch (err: any) {
          console.error(`Error setting password for ${userConfig.username}:`, err.message);
        }
      }
      break;
    }
    case 'Delete': {
      break;
    }
  }

  await db.dispose();
  return {};
};
