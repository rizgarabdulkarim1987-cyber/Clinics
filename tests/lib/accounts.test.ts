import { describe, expect, it } from 'vitest';
import { byClient, byMonth, isLate, owedTotals, parseRate, inPeriod, nextSlug, parsePeriod, periodKey, remainingMinor, slugFromName, summarize, type AccountMovement } from '@/lib/accounts';

const move = (over: Partial<AccountMovement>): AccountMovement => ({
  kind: 'INCOME',
  amountMinor: 100,
  currency: 'IQD',
  clientId: null,
  occurredOn: '2026-11-05',
  ...over,
});

describe('slugFromName', () => {
  it('turns Arabic names into short Latin slugs', () => {
    expect(slugFromName('مطعم الرافدين')).toBe('mtam-alrafdyn');
    expect(slugFromName('شركة النور')).toBe('shrka-alnwr');
  });
  it('keeps Latin names, lowercases them and drops punctuation', () => {
    expect(slugFromName('Cafe Zahra!')).toBe('cafe-zahra');
    expect(slugFromName('  A & B   Studio ')).toBe('a-b-studio');
  });
  it('reads the hamza forms of alef as one letter, so الأمل is al-aml', () => {
    expect(slugFromName('محل الأمل')).toBe('mhl-alaml');
  });
  it('transliterates Sorani letters', () => {
    expect(slugFromName('کافێی ڕۆژ')).toBe('kafey-rozh');
  });
  it('ignores vowel marks and the tatweel', () => {
    expect(slugFromName('مَطْعَم')).toBe(slugFromName('مطعم'));
    expect(slugFromName('مـطـعـم')).toBe(slugFromName('مطعم'));
  });
  it('is empty for a name with no letters or digits', () => {
    expect(slugFromName('!!!')).toBe('');
    expect(slugFromName('')).toBe('');
  });
  it('is never longer than 60 characters and never ends with a dash', () => {
    const slug = slugFromName('a'.repeat(59) + ' bbb');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('nextSlug', () => {
  it('returns the slug when it is free', () => {
    expect(nextSlug('al-nour', new Set())).toBe('al-nour');
  });
  it('adds -2, -3 when it is taken', () => {
    expect(nextSlug('al-nour', new Set(['al-nour']))).toBe('al-nour-2');
    expect(nextSlug('al-nour', new Set(['al-nour', 'al-nour-2']))).toBe('al-nour-3');
  });
  it('falls back to "client" for an empty slug', () => {
    expect(nextSlug('', new Set())).toBe('client');
    expect(nextSlug('', new Set(['client']))).toBe('client-2');
  });
});

describe('inPeriod', () => {
  const rows = [move({ occurredOn: '2026-11-30' }), move({ occurredOn: '2026-12-01' }), move({ occurredOn: '2025-11-05' })];
  it('picks a month', () => {
    expect(inPeriod(rows, { kind: 'month', year: 2026, month: 11 })).toHaveLength(1);
  });
  it('picks a year', () => {
    expect(inPeriod(rows, { kind: 'year', year: 2026 })).toHaveLength(2);
  });
  it('keeps everything for "all"', () => {
    expect(inPeriod(rows, { kind: 'all' })).toHaveLength(3);
  });
});

describe('summarize', () => {
  it('adds income, expense and net per currency and never mixes them', () => {
    const totals = summarize([
      move({ amountMinor: 1_000_000 }),
      move({ kind: 'EXPENSE', amountMinor: 250_000 }),
      move({ currency: 'USD', amountMinor: 5000 }),
      move({ currency: 'USD', kind: 'EXPENSE', amountMinor: 7500 }),
    ]);
    expect(totals.IQD).toEqual({ income: 1_000_000, expense: 250_000, net: 750_000 });
    expect(totals.USD).toEqual({ income: 5000, expense: 7500, net: -2500 });
  });
  it('is all zero for nothing', () => {
    expect(summarize([])).toEqual({ IQD: { income: 0, expense: 0, net: 0 }, USD: { income: 0, expense: 0, net: 0 } });
  });
});

describe('byMonth', () => {
  it('gives twelve months, with the money in the month it happened', () => {
    const months = byMonth(
      [move({ occurredOn: '2026-01-31', amountMinor: 10 }), move({ occurredOn: '2026-02-01', amountMinor: 20 }), move({ kind: 'EXPENSE', occurredOn: '2026-02-10', amountMinor: 5 }), move({ occurredOn: '2025-02-10', amountMinor: 999 })],
      2026,
    );
    expect(months).toHaveLength(12);
    expect(months[0]!.IQD.net).toBe(10);
    expect(months[1]!.IQD).toEqual({ income: 20, expense: 5, net: 15 });
    expect(months[2]!.IQD.net).toBe(0);
  });
});

describe('byClient', () => {
  const names = new Map([
    ['a', 'Al Nour'],
    ['b', 'Rafidain'],
  ]);
  it('profit per client, and the movements with no client on their own last row', () => {
    const rows = byClient(
      [
        move({ clientId: 'a', amountMinor: 1800 }),
        move({ clientId: 'a', kind: 'EXPENSE', amountMinor: 450 }),
        move({ clientId: 'b', amountMinor: 1400 }),
        move({ clientId: 'b', kind: 'EXPENSE', amountMinor: 1500 }),
        move({ clientId: null, kind: 'EXPENSE', amountMinor: 50 }),
      ],
      names,
    );
    expect(rows.map((row) => row.clientId)).toEqual(['a', 'b', null]);
    expect(rows[0]!.totals.IQD.net).toBe(1350);
    expect(rows[1]!.totals.IQD.net).toBe(-100);
    expect(rows[2]!.name).toBeNull();
    expect(rows[2]!.totals.IQD.net).toBe(-50);
  });
  it('sorts by dinar profit then dollar profit, best first', () => {
    const rows = byClient([move({ clientId: 'a', amountMinor: 10 }), move({ clientId: 'b', amountMinor: 30 })], names);
    expect(rows.map((row) => row.clientId)).toEqual(['b', 'a']);
  });
  it('lists no empty "no client" row when every movement has a client', () => {
    expect(byClient([move({ clientId: 'a' })], names).map((row) => row.clientId)).toEqual(['a']);
  });
});

describe('periods in a link', () => {
  it('writes and reads a month, a year and everything', () => {
    for (const period of [{ kind: 'month', year: 2026, month: 11 }, { kind: 'year', year: 2026 }, { kind: 'all' }] as const) {
      expect(parsePeriod(periodKey(period))).toEqual(period);
    }
    expect(periodKey({ kind: 'month', year: 2026, month: 3 })).toBe('month:2026-03');
  });
  it('refuses what is not a period', () => {
    for (const text of ['', 'month:2026-13', 'month:2026-00', 'year:26', 'year:abc', 'week:1', 'month:2026-1', null, undefined]) {
      expect(parsePeriod(text as string | null | undefined)).toBeNull();
    }
  });
});

describe('parseRate', () => {
  it('reads whole dinars per dollar, with commas or Arabic digits', () => {
    expect(parseRate('1500')).toEqual({ ok: true, rate: 1500 });
    expect(parseRate(' 1,520 ')).toEqual({ ok: true, rate: 1520 });
    expect(parseRate('١٤٨٠')).toEqual({ ok: true, rate: 1480 });
  });
  it('refuses empty, zero, fractions, text and absurd rates', () => {
    for (const bad of ['', '0', '-5', '1500.5', 'abc', '100001', '1 500 000']) expect(parseRate(bad).ok, bad).toBe(false);
  });
});

describe('totals with exchange rates', () => {
  const rows = [
    move({ kind: 'INCOME', amountMinor: 1_500_000, currency: 'IQD', rate: 1500 }),
    move({ kind: 'INCOME', amountMinor: 155_000, currency: 'USD', rate: 1500 }), // $1,550.00
    move({ kind: 'EXPENSE', amountMinor: 750_000, currency: 'IQD', rate: 1500 }),
    move({ kind: 'EXPENSE', amountMinor: 48_000, currency: 'USD', rate: 1500 }), // $480.00
  ];

  it('gives the whole of it in dinars and the whole of it in dollars', () => {
    const all = summarize(rows, 1500);
    expect(all.IQD).toEqual({ income: 1_500_000 + 2_325_000, expense: 750_000 + 720_000, net: 2_355_000 });
    expect(all.USD).toEqual({ income: 255_000, expense: 98_000, net: 157_000 });
  });

  it('uses the rate each movement was typed in with, so a later rate changes none of them', () => {
    const old = move({ kind: 'INCOME', amountMinor: 10_000, currency: 'USD', rate: 1500 }); // $100 at 1,500
    const fresh = move({ kind: 'INCOME', amountMinor: 10_000, currency: 'USD', rate: 1400 }); // $100 at 1,400
    expect(summarize([old, fresh], 1400).IQD.income).toBe(150_000 + 140_000);
  });

  it('uses the current rate for a movement typed in before any rate was set', () => {
    expect(summarize([move({ amountMinor: 10_000, currency: 'USD', rate: null })], 1480).IQD.income).toBe(148_000);
  });

  it('is the currencies apart when there is no rate at all', () => {
    expect(summarize(rows, null).IQD.income).toBe(1_500_000);
    expect(summarize(rows, null).USD.income).toBe(155_000);
  });

  it('carries the same conversion into months and clients', () => {
    expect(byMonth(rows, 2026, 1500)[10]!.IQD.net).toBe(2_355_000);
    expect(byClient(rows, new Map(), 1500)[0]!.totals.USD.net).toBe(157_000);
  });

  it('is all zeros when empty', () => {
    expect(summarize([], 1500).USD).toEqual({ income: 0, expense: 0, net: 0 });
  });
});

describe('what clients still owe', () => {
  const owed = (over: Partial<AccountMovement>) => move({ owed: true, paidMinor: 0, ...over });

  it('is what is left of an income marked as not yet paid, and nothing for any other movement', () => {
    expect(remainingMinor(owed({ amountMinor: 1000, paidMinor: 400 }))).toBe(600);
    expect(remainingMinor(owed({ amountMinor: 1000, paidMinor: 1000 }))).toBe(0);
    expect(remainingMinor(owed({ amountMinor: 1000, paidMinor: 1500 }))).toBe(0);
    expect(remainingMinor(move({ amountMinor: 1000 }))).toBe(0); // an old entry counts as paid in full
    expect(remainingMinor(owed({ kind: 'EXPENSE', amountMinor: 1000 }))).toBe(0);
  });

  it('adds up in each currency, and in dinars and dollars with a rate, at the rate of each entry', () => {
    const rows = [
      owed({ amountMinor: 1_000_000, currency: 'IQD', paidMinor: 400_000, rate: 1500 }), // 600,000 dinars left
      owed({ amountMinor: 10_000, currency: 'USD', paidMinor: 0, rate: 1400 }), // $100 left at 1,400
      move({ amountMinor: 999_999 }), // paid in full: not counted
    ];
    expect(owedTotals(rows).IQD.income).toBe(600_000);
    expect(owedTotals(rows).USD.income).toBe(10_000);
    expect(owedTotals(rows, 1500).IQD.income).toBe(600_000 + 140_000);
    expect(owedTotals(rows, 1500).USD.income).toBe(40_000 + 10_000); // 600,000 / 1,500 = $400.00
  });

  it('is late when something is left and it is more than 30 days old', () => {
    const today = '2026-11-20';
    expect(isLate(owed({ occurredOn: '2026-10-21' }), today)).toBe(false); // 30 days
    expect(isLate(owed({ occurredOn: '2026-10-20' }), today)).toBe(true); // 31 days
    expect(isLate(owed({ occurredOn: '2026-01-01', paidMinor: 100 }), today)).toBe(false); // paid in full
    expect(isLate(move({ occurredOn: '2026-01-01' }), today)).toBe(false); // an old entry
  });
});
