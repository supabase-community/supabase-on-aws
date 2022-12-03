import path from 'path';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, PutParameterCommand, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { EventBridgeHandler } from 'aws-lambda';

interface RotationSucceededDetail {
  eventTime: string;
  eventSource: string;
  eventName: string;
  awsRegion: string;
  additionalEventData: {
    SecretId: string;
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

const region = process.env.AWS_REGION;
const writerParameterName = process.env.WRITER_PARAMETER_NAME!;
const readerParameterName = process.env.READER_PARAMETER_NAME!;

const secretsManager = new SecretsManagerClient({ region });
const ssm = new SSMClient({ region });

const getSecret = async (secretId: string) => {
  const cmd = new GetSecretValueCommand({ SecretId: secretId });
  const { SecretString } = await secretsManager.send(cmd);
  const secret = JSON.parse(SecretString!) as dbSecret;
  console.info(`Successfully get secret. ARN:${secretId}`);
  return secret;
};

const putParameter = async (name: string, value: string) => {
  const cmd = new PutParameterCommand({ Name: name, Value: value, Overwrite: true });
  await ssm.send(cmd);
  console.info(`Successfully put parameter. Name:${name}`);
};

const getParametersByPath = async (pathName: string) => {
  const cmd = new GetParametersByPathCommand({ Path: pathName });
  const { Parameters } = await ssm.send(cmd);
  console.info(`Successfully get parameters by path. Path:${pathName}`);
  return Parameters!;
};

export const handler: EventBridgeHandler<'AWS Service Event via CloudTrail', RotationSucceededDetail, any> = async (event, _context) => {
  console.log(JSON.stringify(event));
  const secretId: string = event.detail.additionalEventData.SecretId;
  const secret = await getSecret(secretId);
  const { username, password, host, port } = secret;
  const dbname = secret.dbname || 'postgres';
  const writerUrl = `postgres://${username}:${password}@${host}:${port}/${dbname}`;
  const readerUrl = writerUrl.replace('.cluster-', '.cluster-ro-');
  await putParameter(writerParameterName, writerUrl);
  await putParameter(readerParameterName, readerUrl);
  // Writer with search_path
  const writerWithSearchPath = await getParametersByPath(writerParameterName);
  await Promise.all(writerWithSearchPath.map(async param => {
    const searchPath = path.basename(param.Name!);
    await putParameter(param.Name!, `${writerUrl}?search_path=${searchPath}`);
  }));
  // Reader with search_path
  const readerWithSearchPath = await getParametersByPath(readerParameterName);
  await Promise.all(readerWithSearchPath.map(async param => {
    const searchPath = path.basename(param.Name!);
    await putParameter(param.Name!, `${writerUrl}?search_path=${searchPath}`);
  }));
};