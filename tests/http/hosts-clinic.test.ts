import { describe, expect, it } from 'vitest';
import { routeHost, type HostConfig } from '@/server/http/hosts';

/** The clinic app's own host: it serves the clinic app and nothing of the Studio, so no Studio or other product's page answers there. */

const cfg: HostConfig = {
  publicHost: 'menu.buzzify.tech',
  studioHost: 'hive.example.test',
  pharmacyHost: 'leaf.example.test',
  wholesaleHost: 'wholesales.example.test',
  clinicHost: 'clinics.example.test',
  coreHost: 'core.example.test',
  apexHost: 'buzzify.tech',
  legacyHosts: [],
  rootRedirect: 'https://buzzify.me',
  production: true,
};
const NEXT = { action: 'next' } as const;
const NOT_FOUND = { action: 'notFound' } as const;
const CLINIC = 'clinics.example.test';
const STUDIO = 'hive.example.test';

describe('clinic host', () => {
  it('sends / to the clinic app', () => {
    expect(routeHost({ host: CLINIC, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/clinic' });
  });

  it.each(['/clinic', '/clinic/sign-in', '/clinic/invite/abc', '/clinic/home', '/_next/static/a.js', '/api/cron/clinic-reminders'])('serves %s', (pathname) => {
    expect(routeHost({ host: CLINIC, pathname }, cfg)).toEqual(NEXT);
  });

  it.each(['/studio', '/studio/sign-in', '/studio/invite/abc', '/studio/clinic', '/api/auth/sign-in/email', '/api/studio/export', '/pos', '/pharmacy', '/wholesale', '/agency'])(
    'answers 404 for %s: nothing of the Studio or another product',
    (pathname) => {
      expect(routeHost({ host: CLINIC, pathname }, cfg)).toEqual(NOT_FOUND);
    },
  );
});

describe('other hosts once the clinic host is set', () => {
  it('stops the Studio host serving the clinic app', () => {
    expect(routeHost({ host: STUDIO, pathname: '/clinic/sign-in' }, cfg)).toEqual(NOT_FOUND);
    expect(routeHost({ host: STUDIO, pathname: '/studio/clinic' }, cfg)).toEqual(NEXT);
  });

  it('keeps the Studio host serving the clinic app while no clinic host is set', () => {
    expect(routeHost({ host: STUDIO, pathname: '/clinic/sign-in' }, { ...cfg, clinicHost: null })).toEqual(NEXT);
  });

  it.each(['menu.buzzify.tech', 'leaf.example.test', 'wholesales.example.test'])('never serves the clinic app on %s', (host) => {
    expect(routeHost({ host, pathname: '/clinic/home' }, cfg)).toEqual(NOT_FOUND);
  });
});
