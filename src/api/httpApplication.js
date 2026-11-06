import { readClientConfig } from '@/platform/config';
import { createApplication } from '@/platform/createApplication';
import { createHttpAdapter } from '@/platform/adapters/http';

// Independent builds resolve the application entry here, excluding SDK bootstrap code.
export const application = createApplication(readClientConfig(import.meta.env), {
  http: () => createHttpAdapter(),
});
