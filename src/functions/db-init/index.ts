import createConnectionPool, { sql } from '@databases/pg';
import { CdkCustomResourceHandler, CdkCustomResourceResponse } from 'aws-lambda';
import { getConfig, listFile, runSQLFiles } from '../run-custom-migrations';

// Built according to https://github.com/supabase/postgres/blob/develop/migrations/db/migrate.sh

const initialize = async (secretId: string, host: string) => {
  const baseConfig = await getConfig(secretId);

  const dbAsPostgres = createConnectionPool({ ...baseConfig, host, user: 'postgres' });
  console.log('Connected to PostgreSQL database as postgres');

  await runSQLFiles(listFile('./init-scripts/', '.sql'), dbAsPostgres);

  console.log('Setting password for user supabase_admin');
  await dbAsPostgres.query(
    sql`ALTER USER supabase_admin WITH PASSWORD '${sql.__dangerous__rawValue(baseConfig.password ?? '')}';`,
  );

  console.log('Setting password for user supabase_auth_admin');
  await dbAsPostgres.query(
    sql`ALTER USER supabase_auth_admin WITH PASSWORD '${sql.__dangerous__rawValue(baseConfig.password ?? '')}';`,
  );

  await dbAsPostgres.dispose();

  const dbAsSupabaseAdmin = createConnectionPool({ ...baseConfig, host, user: 'supabase_admin' });
  console.log('Connected to PostgreSQL database as supabase_admin');

  await runSQLFiles(listFile('./migrations/', '.sql'), dbAsSupabaseAdmin);

  await dbAsSupabaseAdmin.dispose();
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
