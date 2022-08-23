import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import { EventBridgeHandler } from 'aws-lambda';

const region = process.env.AWS_REGION;
const urlParameterName = process.env.URL_PARAMETER_NAME!;

interface Detail {
  eventTime: string;
  eventSource: string;
  eventName: string;
  awsRegion: string;
  requestParameters: {
    secretId: string;
  };
  requestID: string;
  eventID: string;
  eventType: string;
}

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
  const client = new SecretsManagerClient({ region });
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await client.send(cmd);
  const secret = JSON.parse(SecretString!) as dbSecret;
  console.info(`getSecret: Successfully get secret for ARN ${secretId}.`);
  client.destroy();
  return secret;
};

const putParameter = async (name: string, value: string) => {
  const client = new SSMClient({ region });
  const cmd = new PutParameterCommand({ Name: name, Value: value, Overwrite: true });
  await client.send(cmd);
  console.info(`getSecret: Successfully put parameter for NAME ${name}.`);
  client.destroy();
};


export const handler: EventBridgeHandler<'AWS API Call via CloudTrail', Detail, any> = async (event, _context) => {
  console.log(JSON.stringify(event));
  const secretId: string = event.detail.requestParameters.secretId;
  const secret = await getSecret(secretId);
  const url = `postgres://${secret.username}:${secret.password}@${secret.host}:${secret.port}/${secret.dbname||'postgres'}`;
  await putParameter(urlParameterName, url);
  await putParameter(urlParameterName.replace('Default', 'Auth'), `${url}?search_path=auth`);
};