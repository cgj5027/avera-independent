import type { AdapterFactory, Application, ClientConfig } from './contracts';

/** Explicit selection; never silently fall back from local/HTTP to cloud data. */
export function createApplication(
  config: ClientConfig,
  adapters: Partial<Record<ClientConfig['backend'], AdapterFactory>>,
): Application {
  if (config.backend !== 'base44' && config.backend !== 'http') {
    throw new Error('Unsupported application backend.');
  }
  const factory = Object.hasOwn(adapters, config.backend) ? adapters[config.backend] : undefined;
  if (!factory) throw new Error(`The ${config.backend} application adapter is not installed.`);
  return factory();
}
