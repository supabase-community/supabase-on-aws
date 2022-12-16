import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { WebhookEvent } from './types';

const region = process.env.AWS_REGION;
const queueUrl = process.env.QUEUE_URL;

const logger = new Logger();
const tracer = new Tracer();
const sqs = tracer.captureAWSv3Client(new SQSClient({ region }));

const sendMessage = async (message: object) => {
  const cmd = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  });
  const output = await sqs.send(cmd);
  return output;
};

export const handler: APIGatewayProxyHandlerV2 = async (event, _context) => {
  let webhookEvent: WebhookEvent;
  try {
    webhookEvent = JSON.parse(event.body!);
  } catch (error) {
    logger.error('Error', { error });
    return { statusCode: 400, body: 'Bad Request' };
  }
  const eventType = webhookEvent.event.type;
  if (['ObjectRemoved:Delete', 'ObjectRemoved:Move', 'ObjectUpdated:Metadata'].includes(eventType)) {
    await sendMessage(webhookEvent);
  }
  return { statusCode: 201 };
};
