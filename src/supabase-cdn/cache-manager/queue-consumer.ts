import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { SQSHandler } from 'aws-lambda';
import { WebhookEvent } from './types';

const distributionId = process.env.DISTRIBUTION_ID!;

const logger = new Logger();
const tracer = new Tracer();
const cloudfront = tracer.captureAWSv3Client(new CloudFrontClient({ region: 'us-east-1' }));

const createInvalidation = async(paths: string[], callerReference: string) => {
  const cmd = new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      Paths: {
        Items: paths,
        Quantity: paths.length,
      },
      CallerReference: callerReference,
    },
  });
  const output = await cloudfront.send(cmd);
  return output;
};

const eventToPath = (event: WebhookEvent): string[] => {
  const bucketId = event.event.payload.bucketId;
  const objectName = event.event.payload.name;
  const objectPaths = [
    `/storage/v1/object/${bucketId}/${objectName}*`,
    `/storage/v1/object/sign/${bucketId}/${objectName}*`,
    `/storage/v1/object/public/${bucketId}/${objectName}*`,
  ];
  return objectPaths;
};

export const handler: SQSHandler = async (event, context) => {
  const webhookEvents = event.Records.map(record => JSON.parse(record.body) as WebhookEvent);
  const paths = webhookEvents.flatMap(eventToPath);
  const output = await createInvalidation(paths, context.awsRequestId);
  logger.info('Create invalidation successfully.', { output });
};
