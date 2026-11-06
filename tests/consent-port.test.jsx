import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const consent = vi.hoisted(() => ({ getInfo: vi.fn(), respond: vi.fn() }));
vi.mock('@/api/application', () => ({ application: { consent } }));
import OAuthConsent from '../src/pages/OAuthConsent';

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/oauth/consent?ctx=opaque%20handle&app_base_url=https://untrusted.example');
});
afterEach(() => window.history.replaceState({}, '', '/'));

it('loads only the opaque handle through the application port and never offers controls for expired requests', async () => {
  consent.getInfo.mockResolvedValue(new Response('{}', { status: 404 }));
  render(<OAuthConsent />);
  expect(await screen.findByText('This authorization link is invalid or has expired.')).toBeTruthy();
  expect(consent.getInfo).toHaveBeenCalledWith('opaque handle');
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  expect(consent.respond).not.toHaveBeenCalled();
});

it('accepts server-authenticated consent and renders a terminal state when the handle has been consumed', async () => {
  consent.getInfo.mockResolvedValue(Response.json({ authenticated: true, client_name: 'Fixture client', tools: [{ name: 'read', title: 'Read accounts' }] }));
  consent.respond.mockResolvedValue(Response.json({ detail: 'The tool set changed. Reconnect to continue.' }, { status: 409 }));
  render(<OAuthConsent />);
  expect(await screen.findByText('Read accounts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  expect(await screen.findByRole('heading', { name: 'Reconnect required' })).toBeTruthy();
  expect(consent.respond).toHaveBeenCalledWith('opaque handle', 'deny');
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
});

it('does not send a consent request without a handle', async () => {
  window.history.replaceState({}, '', '/oauth/consent');
  render(<OAuthConsent />);
  expect(await screen.findByText('This authorization link is invalid or has expired.')).toBeTruthy();
  expect(consent.getInfo).not.toHaveBeenCalled();
});
