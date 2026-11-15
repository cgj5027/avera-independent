import type { ClientConfig } from './contracts';

/** Public configuration contains no database paths, credentials or provider URLs. */
export function readClientConfig(env: Record<string, unknown> = {}): Readonly<ClientConfig> {
  const backend = env.VITE_AVERA_BACKEND ?? 'http';
  if (backend !== 'http') {
    throw new Error('VITE_AVERA_BACKEND must be http; platform compatibility has been retired.');
  }
  return Object.freeze({ backend });
}
