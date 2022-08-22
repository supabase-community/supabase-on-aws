import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { EventBridgeHandler } from 'aws-lambda';

const region = process.env.AWS_REGION;
const cluster = process.env.ECS_CLUSTER_NAME;
const service = process.env.ECS_SERVICE_NAME;

export const handler: EventBridgeHandler<any, any, any> = async (_event, _context) => {
  const client = new ECSClient({ region });
  const cmd = new UpdateServiceCommand({
    cluster,
    service,
    forceNewDeployment: true,
  });
  await client.send(cmd);
  client.destroy();
};