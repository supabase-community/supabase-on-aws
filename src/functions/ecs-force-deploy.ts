import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { EventBridgeHandler } from 'aws-lambda';

const region = process.env.AWS_REGION;
const cluster = process.env.ECS_CLUSTER_NAME;
const service = process.env.ECS_SERVICE_NAME;
const forceNewDeployment = true;

export const handler: EventBridgeHandler<any, any, any> = async (_event, _context) => {
  const client = new ECSClient({ region });
  const cmd = new UpdateServiceCommand({ cluster, service, forceNewDeployment });
  const output = await client.send(cmd);
  console.info(JSON.stringify(output));
  client.destroy();
};