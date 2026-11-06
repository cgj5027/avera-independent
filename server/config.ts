/** Backend-only configuration. Do not import this module into frontend source. */
type Environment = Record<string, string | undefined>;

function choice<T extends string>(env: Environment, key: string, choices: readonly T[], fallback: T): T {
  const value = env[key] ?? fallback;
  if (!choices.includes(value as T)) throw new Error(`Invalid ${key}.`);
  return value as T;
}
function path(env: Environment, key: string, fallback: string): string {
  const value = env[key] ?? fallback;
  if (!value.trim() || value.includes('\0')) throw new Error(`Invalid ${key}.`);
  return value;
}
function gatewayUrl(value: string | undefined): string | null {
  if (value === undefined) return null; // Not configured: finance still works; online services must remain unavailable.
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch { throw new Error('Invalid AVERA_GATEWAY_URL.'); }
}
export function readServerConfig(env: Environment = {}) {
  const driver = choice(env, 'AVERA_DATA_STORE', ['sqlite', 'postgres'] as const, 'sqlite');
  const integrationMode = choice(env, 'AVERA_INTEGRATION_MODE', ['gateway', 'direct'] as const, 'gateway');
  if (env.AVERA_SYNC_ENABLED !== undefined && env.AVERA_SYNC_ENABLED !== 'false') {
    throw new Error('Multi-device synchronization is not available in version 1.');
  }
  let connectionString: string | undefined;
  if (driver === 'postgres') {
    try {
      const url = new URL(env.AVERA_DATABASE_URL ?? '');
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) throw new Error();
      connectionString = env.AVERA_DATABASE_URL;
    } catch { throw new Error('A valid AVERA_DATABASE_URL is required for postgres.'); }
  }
  return Object.freeze({
    storage: Object.freeze(driver === 'sqlite'
      ? { driver, path: path(env, 'AVERA_SQLITE_PATH', 'data/avera.sqlite') }
      : { driver, connectionString: connectionString! }),
    files: Object.freeze({ path: path(env, 'AVERA_FILES_PATH', 'data/files') }),
    integrations: Object.freeze({ mode: integrationMode, gatewayUrl: gatewayUrl(env.AVERA_GATEWAY_URL) }),
    synchronization: false as const,
  });
}
