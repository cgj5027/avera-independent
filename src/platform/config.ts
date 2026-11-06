import type { ClientConfig } from './contracts';

/** Public configuration contains no database paths, credentials or provider URLs. */
export function readClientConfig(env: Record<string, unknown> = {}): Readonly<ClientConfig> {
  const backend = env.VITE_AVERA_BACKEND ?? 'base44';
  if (backend !== 'base44' && backend !== 'http') {
    throw new Error('VITE_AVERA_BACKEND must be base44 or http.');
  }
  return Object.freeze({ backend });
}
