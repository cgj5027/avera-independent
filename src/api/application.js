import { readClientConfig } from '@/platform/config';
import { createApplication } from '@/platform/createApplication';
import { createBase44Adapter } from '@/platform/adapters/base44';
import { createHttpAdapter } from '@/platform/adapters/http';

const config = readClientConfig(import.meta.env);
// Do not load the SDK/token bootstrap at all when using the independent backend.
const legacy = config.backend === 'base44' ? await Promise.all([
  import('./base44Client'), import('@/lib/app-params'),
]) : null;
export const application = createApplication(config, {
  http: () => createHttpAdapter(),
  ...(legacy ? { base44: () => createBase44Adapter({ client: legacy[0].base44, params: legacy[1].appParams }) } : {}),
});
