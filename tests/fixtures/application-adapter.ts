import type { Application, Collection, Fields } from '../../src/platform/contracts';
import { PUBLIC_COLLECTIONS } from '../../src/platform/contracts';

/** Test-only in-memory application contract; never packaged or imported by production. */
interface FixtureClient {
  auth: Record<
    'me' | 'updateMe' | 'loginViaEmailPassword' | 'register' | 'verifyOtp' |
    'setToken' | 'resendOtp' | 'resetPasswordRequest' | 'resetPassword' |
    'loginWithProvider' | 'logout' | 'redirectToLogin', (...args: any[]) => any
  >;
  entities: Record<string, Record<
    'filter' | 'get' | 'create' | 'update' | 'delete' | 'bulkCreate', (...args: any[]) => any
  >>;
  functions: { invoke(name: string, payload?: unknown): Promise<any> };
  app: { getPublicSettings(): Promise<Fields> };
}
interface FixtureParams { appId?: string; token?: string | null }

export function createFixtureApplication({ client, params, fetcher = globalThis.fetch.bind(globalThis) }: {
  client: FixtureClient;
  params: FixtureParams;
  fetcher?: typeof fetch;
}): Application {
  const collections = new Map<string, Collection>();
  function collection(name: string): Collection {
    if (!(PUBLIC_COLLECTIONS as readonly string[]).includes(name)) throw new Error('Unknown record collection.');
    if (!collections.has(name)) {
      // Resolve the entity on each call so fixture session/collection changes propagate.
      const entity = () => client.entities[name];
      collections.set(name, {
        list: (query = {}, options = {}) => entity().filter(query, options),
        get: id => entity().get(id),
        create: fields => entity().create(fields),
        update: (id, fields) => entity().update(id, fields),
        delete: id => entity().delete(id),
        createMany: rows => entity().bulkCreate(rows),
      });
    }
    return collections.get(name)!;
  }
  function consentPath(action: string) {
    if (!params.appId) throw new Error('Authorization service is not configured.');
    return `/api/apps/${encodeURIComponent(params.appId)}/mcp/${action}`;
  }
  function headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
    };
  }
  return {
    auth: {
      hasSession: () => Boolean(params.token),
      currentUser: () => client.auth.me(),
      updateProfile: fields => client.auth.updateMe(fields),
      signIn: (email, password) => client.auth.loginViaEmailPassword(email, password),
      register: fields => client.auth.register(fields),
      verifyEmail: fields => client.auth.verifyOtp(fields),
      setSessionToken: token => client.auth.setToken(token),
      resendVerification: email => client.auth.resendOtp(email),
      requestPasswordReset: email => client.auth.resetPasswordRequest(email),
      resetPassword: fields => client.auth.resetPassword(fields),
      signInWithProvider: (provider, returnTo) => client.auth.loginWithProvider(provider, returnTo),
      signOut: redirect => redirect === undefined ? client.auth.logout() : client.auth.logout(redirect),
      redirectToSignIn: returnTo => client.auth.redirectToLogin(returnTo),
    },
    records: { collection },
    services: { invoke: (name, payload) => client.functions.invoke(name, payload) },
    files: { parseResume: input => client.functions.invoke('parseResume', input) },
    settings: { getPublic: () => client.app.getPublicSettings() },
    consent: {
      getInfo: handle => fetcher(`${consentPath('consent-info')}?handle=${encodeURIComponent(handle)}`, {
        credentials: 'include', headers: headers(),
      }),
      respond: (handle, action) => fetcher(consentPath('authorize-grant'), {
        method: 'POST', credentials: 'include', headers: headers(true),
        body: JSON.stringify({ ctx: handle, action }),
      }),
    },
  };
}
