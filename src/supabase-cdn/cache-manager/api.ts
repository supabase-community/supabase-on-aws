import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Handler } from 'aws-lambda';
import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { bearerAuth } from 'hono/bearer-auth';
import { WebhookEvent } from './types';

/** AWS region */
const region = process.env.AWS_REGION;
/** SQS queue URL */
const queueUrl = process.env.QUEUE_URL;
/** Bearer token */
const token = process.env.API_KEY!;

const logger = new Logger();
const tracer = new Tracer();
const sqs = tracer.captureAWSv3Client(new SQSClient({ region }));

/**
 * Send message to SQS
 * @param message webhook event
 * @returns void
 */
const enqueue = async (message: object) => {
  const cmd = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  });
  const output = await sqs.send(cmd);
  return output;
};

/** Hono app */
const app = new Hono();

/** Webhook endpoint */
app.post('/', bearerAuth({ token }), async (c) => {
  const body: WebhookEvent = await c.req.json();
  console.log(JSON.stringify(body));

  await enqueue(body);
  return c.text('Accepted', 202);
});

/** Lambda handler */
export const handler = handle(app) as Handler;
