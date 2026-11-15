import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readClientConfig } from '../src/platform/config';
import { readServerConfig } from '../server/config';
import { createApplication } from '../src/platform/createApplication';
import { createFixtureApplication } from './fixtures/application-adapter';
import type { Application } from '../src/platform/contracts';

function fixture(token: string | null = 'fixture-token') {
  const entity = {
    filter: vi.fn().mockResolvedValue({ items: [{ id: 'a', created_by_id: 'owner' }], has_more: true, next_cursor: 'cursor' }),
    get: vi.fn().mockResolvedValue({ id: 'a', created_by_id: 'owner' }),
    create: vi.fn().mockResolvedValue({ id: 'new' }),
    update: vi.fn().mockResolvedValue({ id: 'a', balance: 25 }),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    bulkCreate: vi.fn().mockResolvedValue([{ id: 'new' }]),
  };
  const auth = Object.fromEntries([
    'me', 'updateMe', 'loginViaEmailPassword', 'register', 'verifyOtp', 'setToken',
    'resendOtp', 'resetPasswordRequest', 'resetPassword', 'loginWithProvider', 'logout', 'redirectToLogin',
  ].map(name => [name, vi.fn().mockResolvedValue({ id: 'owner' })]));
  const client = {
    auth,
    // SDK entities are a dynamic Proxy, not an object with own collection keys.
    entities: new Proxy({}, { get: () => entity }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { saved: true } }) },
    app: { getPublicSettings: vi.fn().mockResolvedValue({ public_settings: {} }) },
  };
  const params = { appId: 'fixture-app', token };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const application = createFixtureApplication({ client, params, fetcher });
  return { application, client, entity, params, fetcher };
}

describe('explicit backend selection', () => {
  it('uses the independent HTTP default and selects only the requested factory', () => {
    const legacy = fixture().application;
    const alternative = { name: 'independent implementation' } as unknown as Application;
    const fixtureClient = vi.fn(() => legacy);
    const http = vi.fn(() => alternative);
    expect(readClientConfig()).toEqual({ backend: 'http' });
    expect(createApplication(readClientConfig({ VITE_AVERA_BACKEND: 'http' }), { fixtureClient, http })).toBe(alternative);
    expect(fixtureClient).not.toHaveBeenCalled();
    expect(http).toHaveBeenCalledOnce();
  });
  it('never falls back to the cloud if a selected implementation is absent or fails', () => {
    const fixtureClient = vi.fn(() => fixture().application);
    expect(() => createApplication({ backend: 'http' }, { fixtureClient })).toThrow('not installed');
    const failure = new Error('Local service unavailable');
    expect(() => createApplication({ backend: 'http' }, { fixtureClient, http: () => { throw failure; } })).toThrow(failure);
    expect(fixtureClient).not.toHaveBeenCalled();
    expect(() => readClientConfig({ VITE_AVERA_BACKEND: 'localStorage' })).toThrow('VITE_AVERA_BACKEND');
  });
});

describe('backend-only storage and provider configuration', () => {
  it('defaults to SQLite, private local files, gateway integration, and no synchronization', () => {
    const config = readServerConfig();
    expect(config).toEqual({
      storage: { driver: 'sqlite', path: 'data/avera.sqlite' },
      files: { path: 'data/files' },
      integrations: { mode: 'gateway', gatewayUrl: null },
      synchronization: false,
    });
    expect(Object.isFrozen(config.storage)).toBe(true);
  });
  it('accepts hosted storage and explicit direct-provider selection without exposing them to the client', () => {
    const env = { AVERA_DATA_STORE: 'postgres', AVERA_DATABASE_URL: 'postgresql://example.test/avera', AVERA_INTEGRATION_MODE: 'direct' };
    expect(readServerConfig(env).storage).toEqual({ driver: 'postgres', connectionString: env.AVERA_DATABASE_URL });
    expect(readServerConfig(env).integrations.mode).toBe('direct');
    expect(readClientConfig(env)).toEqual({ backend: 'http' });
    expect(readServerConfig({ AVERA_SQLITE_PATH: 'D:\\Avera\\data.sqlite', AVERA_FILES_PATH: '/data/private' }).storage)
      .toEqual({ driver: 'sqlite', path: 'D:\\Avera\\data.sqlite' });
  });
  it.each([
    { AVERA_DATA_STORE: 'localStorage' }, { AVERA_INTEGRATION_MODE: 'unknown' },
    { AVERA_DATA_STORE: 'postgres' }, { AVERA_DATA_STORE: 'postgres', AVERA_DATABASE_URL: 'https://example.test/db' },
    { AVERA_SYNC_ENABLED: 'true' }, { AVERA_SQLITE_PATH: '' }, { AVERA_FILES_PATH: '\0bad' },
  ])('rejects invalid or unimplemented configuration %j', env => {
    expect(() => readServerConfig(env)).toThrow();
  });
  it.each(['http://example.test', 'https://user:private@example.test', 'https://example.test?token=private', 'https://example.test/#private', 'file:///tmp/gateway', ''])('rejects unsafe gateway configuration without echoing it', value => {
    try { readServerConfig({ AVERA_GATEWAY_URL: value }); throw new Error('Expected rejection'); }
    catch (error) { expect((error as Error).message).toBe('Invalid AVERA_GATEWAY_URL.'); }
  });
  it('accepts secure gateways and explicit loopback development gateways', () => {
    expect(readServerConfig({ AVERA_GATEWAY_URL: 'https://gateway.example.test/api/' }).integrations.gatewayUrl).toBe('https://gateway.example.test/api');
    expect(readServerConfig({ AVERA_GATEWAY_URL: 'http://127.0.0.1:8080' }).integrations.gatewayUrl).toBe('http://127.0.0.1:8080');
  });
});

describe('compatibility adapter contract', () => {
  it('preserves record pagination, ownership filters, writes and bulk seeding through a dynamic SDK', async () => {
    const { application, entity } = fixture();
    const records = application.records.collection('Account');
    const query = { created_by_id: 'owner', demo_profile: 'scenario' };
    const options = { limit: 50, cursor: 'previous' };
    expect(await records.list(query, options)).toMatchObject({ has_more: true, next_cursor: 'cursor' });
    expect(entity.filter).toHaveBeenCalledWith(query, options);
    await records.get('a'); expect(entity.get).toHaveBeenCalledWith('a');
    await records.create({ balance: 10 }); expect(entity.create).toHaveBeenCalledWith({ balance: 10 });
    await records.update('a', { balance: 25 }); expect(entity.update).toHaveBeenCalledWith('a', { balance: 25 });
    await records.delete('a'); expect(entity.delete).toHaveBeenCalledWith('a');
    await records.createMany([{ balance: 10 }]); expect(entity.bulkCreate).toHaveBeenCalledWith([{ balance: 10 }]);
  });
  it.each(['PlaidCredential', 'ServiceUsage', '__proto__', '../Account'])('does not expose private or unknown collection %s', name => {
    expect(() => fixture().application.records.collection(name)).toThrow('Unknown record collection');
  });
  it('does not cache identities or swallow backend authorization and quota errors', async () => {
    const { application, client, params } = fixture();
    await expect(application.auth.currentUser()).resolves.toEqual({ id: 'owner' });
    client.auth.me.mockResolvedValue({ id: 'other' });
    await expect(application.auth.currentUser()).resolves.toEqual({ id: 'other' });
    expect(application.auth.hasSession()).toBe(true);
    params.token = null; expect(application.auth.hasSession()).toBe(false);
    const denied = Object.assign(new Error('Denied'), { status: 403 });
    client.auth.me.mockRejectedValue(denied);
    await expect(application.auth.currentUser()).rejects.toBe(denied);
    client.functions.invoke.mockRejectedValue(denied);
    await expect(application.services.invoke('askAvera', {})).rejects.toBe(denied);
  });
  it('preserves login, verification, profile, reset, provider and logout operations', async () => {
    const { application: { auth }, client } = fixture();
    await auth.signIn('fixture@example.test', 'test-password');
    expect(client.auth.loginViaEmailPassword).toHaveBeenCalledWith('fixture@example.test', 'test-password');
    await auth.register({ email: 'fixture@example.test', password: 'test-password' });
    await auth.verifyEmail({ email: 'fixture@example.test', otpCode: '123456' });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'fixture@example.test', otpCode: '123456' });
    auth.setSessionToken('fixture'); expect(client.auth.setToken).toHaveBeenCalledWith('fixture');
    await auth.resendVerification('fixture@example.test'); expect(client.auth.resendOtp).toHaveBeenCalledWith('fixture@example.test');
    await auth.requestPasswordReset('fixture@example.test'); expect(client.auth.resetPasswordRequest).toHaveBeenCalledWith('fixture@example.test');
    await auth.resetPassword({ resetToken: 'fixture', newPassword: 'test-password' });
    expect(client.auth.resetPassword).toHaveBeenCalledWith({ resetToken: 'fixture', newPassword: 'test-password' });
    await auth.updateProfile({ display_name: 'Example' }); expect(client.auth.updateMe).toHaveBeenCalledWith({ display_name: 'Example' });
    auth.signInWithProvider('google', '/properties'); expect(client.auth.loginWithProvider).toHaveBeenCalledWith('google', '/properties');
    auth.redirectToSignIn('/properties'); expect(client.auth.redirectToLogin).toHaveBeenCalledWith('/properties');
    auth.signOut(); auth.signOut('/login'); expect(client.auth.logout.mock.calls).toEqual([[], ['/login']]);
  });
  it('routes online services and private resume processing through separate application ports', async () => {
    const { application, client } = fixture();
    const input = { consent: true, file_name: 'resume.txt', file_base64: 'Zml4dHVyZQ==' };
    await application.files.parseResume(input);
    expect(client.functions.invoke).toHaveBeenCalledWith('parseResume', input);
    await application.services.invoke('askAvera', { question: 'My budget?', dataset: { mode: 'ordinary' } });
    expect(client.functions.invoke).toHaveBeenLastCalledWith('askAvera', { question: 'My budget?', dataset: { mode: 'ordinary' } });
    await application.settings.getPublic(); expect(client.app.getPublicSettings).toHaveBeenCalledOnce();
  });
  it('preserves cookie-only consent sessions and backend single-use-handle status', async () => {
    const { application, fetcher, params } = fixture(null);
    await application.consent.getInfo('opaque & handle');
    expect(fetcher).toHaveBeenCalledWith('/api/apps/fixture-app/mcp/consent-info?handle=opaque%20%26%20handle', { credentials: 'include', headers: {} });
    params.token = 'fixture';
    const expired = new Response('{}', { status: 401 });
    fetcher.mockResolvedValue(expired);
    expect(await application.consent.respond('opaque', 'deny')).toBe(expired);
    expect(fetcher).toHaveBeenLastCalledWith('/api/apps/fixture-app/mcp/authorize-grant', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' },
      body: JSON.stringify({ ctx: 'opaque', action: 'deny' }),
    });
  });
});

it('keeps SDK/client configuration imports and platform URLs outside feature code', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  }
  for (const file of ['src/pages', 'src/components', 'src/services', 'src/lib'].flatMap(walk)) {
    const normalized = file.replaceAll('\\', '/');
    if (!/\.(jsx?|tsx?)$/.test(file) || normalized === 'src/lib/app-params.js') continue;
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*(?:@base44\/sdk|base44Client|app-params)/);
    expect(source, file).not.toMatch(/\/api\/apps\//);
  }
  for (const file of walk('src').filter(path => /\.(jsx?|tsx?)$/.test(path))) {
    expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*server\/config/);
  }
});
