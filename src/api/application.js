import { createApplication } from '@/platform/createApplication';
import { readClientConfig } from '@/platform/config';
import { createHttpAdapter } from '@/platform/adapters/http';

export const application=createApplication(readClientConfig(),{http:()=>createHttpAdapter()});
