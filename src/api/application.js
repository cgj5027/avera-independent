import { base44 } from './base44Client';
import { appParams } from '@/lib/app-params';
import { readClientConfig } from '@/platform/config';
import { createApplication } from '@/platform/createApplication';
import { createBase44Adapter } from '@/platform/adapters/base44';

/** Composition root. HTTP/local implementation arrives in the durable-storage stage. */
export const application = createApplication(readClientConfig(import.meta.env), {
  base44: () => createBase44Adapter({ client: base44, params: appParams }),
});
