import { describe, expect, it } from 'vitest';
import { clientSpaceMessages, spaceCatalog } from '@/studio/messages';
import beautyAr from '@/studio/messages/beauty/ar';
import beautyCkb from '@/studio/messages/beauty/ckb';
import beautyEn from '@/studio/messages/beauty/en';
import clinicEn from '@/studio/messages/clinic/en';
import { routeHost } from '@/server/http/hosts';

/** A beauty centre's words are laid over the clinic's: same keys, no clinical vocabulary on its screens. */

describe('Beauty words', () => {
  it('keeps the same keys in the three language files', () => {
    const keys = (messages: Record<string, string>) => Object.keys(messages).sort();
    expect(keys(beautyAr)).toEqual(keys(beautyEn));
    expect(keys(beautyCkb)).toEqual(keys(beautyEn));
  });

  it('only replaces keys the clinic already has', () => {
    for (const key of Object.keys(beautyEn)) expect(clinicEn, key).toHaveProperty([key]);
  });

  it('says specialist and client, never doctor or patient, where it replaces a word', () => {
    // A placeholder such as {clinic} is a parameter name, not a word the person reads.
    for (const [key, value] of Object.entries(beautyEn)) expect(value.replace(/\{\w+\}/g, ''), key).not.toMatch(/\b(doctors?|patients?|clinics?)\b/i);
  });

  it('leaves the clinic’s own catalog alone', () => {
    expect(spaceCatalog('CLINIC').en['clinic.app.nav.doctors']).toBe('Doctors');
    expect(spaceCatalog('BEAUTY').en['clinic.app.nav.doctors']).toBe('Specialists');
    expect(clientSpaceMessages('en', 'BEAUTY')['clinic.app.nav.patients']).toBe('Clients');
    expect(clientSpaceMessages('en', 'BEAUTY')['clinic.app.nav.cashier']).toBe(clientSpaceMessages('en', 'CLINIC')['clinic.app.nav.cashier']);
  });

  it('serves /beauty wherever /clinic is served', () => {
    const cfg = { publicHost: 'menu.test', studioHost: 'studio.test', clinicHost: 'clinic.test', production: true } as never;
    const at = (host: string, pathname: string) => routeHost({ host, pathname, search: '', coreGate: false }, cfg);
    expect(at('clinic.test', '/beauty/board')).toEqual({ action: 'next' });
    expect(at('studio.test', '/beauty/board')).toEqual({ action: 'notFound' });
  });
});
