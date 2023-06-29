// https://github.com/supabase/storage-api/blob/master/src/storage/backend/generic.ts#L23
export type ObjectMetadata = {
  cacheControl: string;
  contentLength: number;
  size: number;
  mimetype: string;
  lastModified?: Date;
  eTag: string;
  contentRange?: string;
  httpStatusCode: number;
}

// https://github.com/supabase/storage-api/blob/master/src/queue/events/base-event.ts
export interface BasePayload {
  $version: string;
  tenant: {
    ref: string;
    host: string;
  };
}

// https://github.com/supabase/storage-api/blob/master/src/queue/events/object-created.ts
interface ObjectCreatedEvent extends BasePayload {
  name: string;
  bucketId: string;
  metadata: ObjectMetadata;
}

// https://github.com/supabase/storage-api/blob/master/src/queue/events/object-removed.ts
interface ObjectRemovedEvent extends BasePayload {
  name: string;
  bucketId: string;
}

// https://github.com/supabase/storage-api/blob/master/src/queue/events/object-updated.ts
interface ObjectUpdatedMetadataEvent extends BasePayload {
  name: string;
  bucketId: string;
  metadata: ObjectMetadata;
}

type EventName = 'ObjectCreated:Put'|'ObjectCreated:Post'|'ObjectCreated:Copy'|'ObjectCreated:Move'|'ObjectRemoved:Delete'|'ObjectRemoved:Move'|'ObjectUpdated:Metadata'

// https://github.com/supabase/storage-api/blob/master/src/queue/events/webhook.ts#L9
export interface WebhookEvent {
  type: string;
  event: {
    $version: string;
    type: EventName;
    payload: ObjectCreatedEvent|ObjectRemovedEvent|ObjectUpdatedMetadataEvent;
    applyTime: number;
  };
  sentAt: string;
  tenant: {
    ref: string;
    host: string;
  };
}
