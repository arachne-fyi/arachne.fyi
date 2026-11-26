// Writes JSON Schema files from the zod definitions, for readers who are not using TypeScript
// (the Java mod mirrors these by hand in `mod/src/main/java/fyi/arachne/mod/sync`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { BatchReply, BatchRequest, Event, LiveRequest } from '../src/events.ts';

const dir = new URL('../schema/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, schema] of Object.entries({ event: Event, 'batch-request': BatchRequest, 'batch-reply': BatchReply, 'live-request': LiveRequest })) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(new URL(`${name}.schema.json`, dir), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote schema/${name}.schema.json`);
}
