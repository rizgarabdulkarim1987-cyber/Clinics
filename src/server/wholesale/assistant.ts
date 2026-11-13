/* eslint-disable no-restricted-properties -- the monthly counter binds the company's own id */
import { resolveAiProvider } from '@/server/ai/settings';
import { getPrisma } from '@/server/data/prisma';
import type { ScopedTx } from '@/server/data/tenant-db';
import { ASSISTANT_MONTHLY_LIMIT, itemsNamed, periodFor, periodRange, toolsFor, type AssistantPeriod, type AssistantTool } from '@/server/domain/wholesale/assistant';
import { addDays } from '@/server/domain/wholesale/forecast';
import { D } from '@/server/domain/wholesale/money';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import type { Locale } from '@/lib/locale';
import { listPendingHandovers } from '@/server/wholesale/posting/custody';
import { listExpenses } from '@/server/wholesale/posting/expense';
import { cashPosition, debts, lowStock, partyBalances, profit, salesByDay, stockValue } from '@/server/wholesale/posting/reports';
import { listPendingSales } from '@/server/wholesale/posting/sale';
import { getStudioTranslator } from '@/studio/messages';
import { askAgent } from './assistantAgent';

type Db = ScopedTx;
/** Runs a short transaction on the company's scoped client; the model call never happens inside one. */
export type Run = <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;

export type AssistantTable = { tool: string; title: string; rows: { label: string; value: string }[] };
export type AssistantDegraded = 'NO_TOOL' | 'NO_AI' | 'LIMIT' | 'PROVIDER_ERROR' | 'UNGROUNDED';
export type AssistantAnswer = {
  /** The model's phrasing, only when every figure in it is in the tables. Null: the tables answer. */
  text: string | null;
  tables: AssistantTable[];
  period: { from: string; to: string } | null;
  degraded?: AssistantDegraded;
  used: number;
};

const money = (v: { toFixed(dp?: number): string }): string => Number(v.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: Locale) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;
const LOW_LIMIT = 8;
const PARTY_LIMIT = 8;

/** Runs one tool: the books in, a small table out. */
async function runTool(db: Db, tool: AssistantTool, ctx: { locale: Locale; period: { from: string; to: string }; user: { id: string; role: 'OWNER' | 'PARTNER' | 'REP' } }): Promise<AssistantTable> {
  const t = getStudioTranslator(ctx.locale);
  const title = t(`wh.assistant.tool.${tool}`);
  switch (tool) {
    case 'item':
      // built by itemTable, which knows which items the question names
      return { tool, title, rows: [] };
    case 'cash': {
      const p = await cashPosition(db);
      const rows = (['IQD', 'USD', 'IRT'] as const).map((c) => ({ label: t(`wh.currency.${c}`), value: `${money(p.cash[c] ?? { toFixed: () => '0' })} ${c}` }));
      for (const [c, v] of Object.entries(p.repCustody)) rows.push({ label: `${t('wh.home.withReps')} (${c})`, value: `${money(v)} ${c}` });
      return { tool, title, rows };
    }
    case 'debts': {
      const [owed, customers, suppliers] = await Promise.all([debts(db), partyBalances(db, 'AR'), partyBalances(db, 'AP')]);
      const line = (b: Record<string, { toFixed(dp?: number): string } | undefined>) => Object.entries(b).map(([c, v]) => `${money(v!)} ${c}`).join(' · ') || '0';
      const rows = [
        { label: t('wh.home.receivable'), value: line(owed.receivable) },
        { label: t('wh.home.payable'), value: line(owed.payable) },
        ...customers.slice(0, PARTY_LIMIT).map((p) => ({ label: p.name, value: line(p.balances) })),
        ...suppliers.slice(0, PARTY_LIMIT).map((p) => ({ label: p.name, value: line(p.balances) })),
      ];
      return { tool, title, rows };
    }
    case 'profit': {
      const p = await profit(db, ctx.period);
      return {
        tool,
        title,
        rows: [
          { label: t('wh.reports.sales'), value: money(p.salesIqd) },
          { label: t('wh.reports.cogs'), value: money(p.cogsIqd) },
          { label: t('wh.reports.gross'), value: money(p.grossIqd) },
          { label: t('wh.reports.net'), value: money(p.netIqd) },
        ],
      };
    }
    case 'sales': {
      const days = await salesByDay(db, ctx.period);
      const sum = days.reduce((s, d) => s.plus(d.iqd), new D(0));
      const count = days.reduce((n, d) => n + d.count, 0);
      return { tool, title, rows: [{ label: t('wh.home.invoices'), value: String(count) }, { label: t('wh.reports.sales'), value: money(sum) }] };
    }
    case 'stock': {
      const s = await stockValue(db);
      const low = lowStock(s.rows).slice(0, LOW_LIMIT);
      return {
        tool,
        title,
        rows: [
          { label: t('wh.home.stockValue'), value: `${money(s.totalIqd)} IQD` },
          ...low.map((x) => ({ label: `${nameOf(x.names as Names, ctx.locale)} (${t('wh.home.lowStock')})`, value: `${money(x.qtyBase)} / ${money(x.reorderPoint)}` })),
        ],
      };
    }
    case 'pending': {
      const [sales, handovers, expenses] = await Promise.all([listPendingSales(db), listPendingHandovers(db), listExpenses(db, ctx.user, 'PENDING')]);
      return {
        tool,
        title,
        rows: [
          { label: t('wh.home.pendingSales'), value: String(sales.length) },
          { label: t('wh.home.pendingHandovers'), value: String(handovers.length) },
          { label: t('wh.home.pendingExpenses'), value: String(expenses.length) },
        ],
      };
    }
  }
}

/** What is on hand of the items the question names: per warehouse, in the item's smallest unit, and the total. */
async function itemTable(db: Db, ids: string[], locale: Locale): Promise<AssistantTable> {
  const t = getStudioTranslator(locale);
  const items = await db.whItem.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, names: true, baseUnit: true } });
  const balances = await db.whStockBalance.findMany({ where: { itemId: { in: ids }, qtyBase: { not: 0 } }, select: { itemId: true, qtyBase: true, warehouse: { select: { name: true, kind: true } } } });
  const rows: { label: string; value: string }[] = [];
  for (const id of ids) {
    const item = items.find((x) => x.id === id);
    if (!item) continue;
    const name = `${nameOf(item.names as Names, locale)} (${item.code})`;
    const unit = t(`wh.unit.${item.baseUnit}`);
    const mine = balances.filter((b) => b.itemId === id);
    if (mine.length === 0) rows.push({ label: name, value: `0 ${unit}` });
    for (const b of mine) rows.push({ label: mine.length > 1 ? `${name} · ${b.warehouse.kind === 'MAIN' ? t('wh.stock.kind.MAIN') : b.warehouse.name}` : name, value: `${money(new D(b.qtyBase.toString()))} ${unit}` });
    if (mine.length > 1) rows.push({ label: `${name} · ${t('wh.purchases.total')}`, value: `${money(mine.reduce((sum, b) => sum.plus(b.qtyBase.toString()), new D(0)))} ${unit}` });
  }
  return { tool: 'item', title: t('wh.assistant.tool.item'), rows };
}

const monthKey = (today: string) => `aiUsage:${today.slice(0, 7)}`;

/** Reserves one question of this month's allowance; null when the allowance is spent. Atomic: two questions cannot both take the last one. */
export async function reserve(db: Db, rid: string, userId: string, today: string): Promise<number | null> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    INSERT INTO "WhSetting" (id, "restaurantId", key, value, "updatedById", "updatedAt")
    VALUES (gen_random_uuid()::text, ${rid}, ${monthKey(today)}, '1'::jsonb, ${userId}, now())
    ON CONFLICT ("restaurantId", key) DO UPDATE
      SET value = to_jsonb((("WhSetting".value #>> '{}')::int) + 1), "updatedAt" = now()
      WHERE (("WhSetting".value #>> '{}')::int) < ${ASSISTANT_MONTHLY_LIMIT}
    RETURNING (value #>> '{}')::int AS n`;
  return rows[0]?.n ?? null;
}

export async function release(db: Db, rid: string, today: string): Promise<void> {
  await db.$executeRaw`UPDATE "WhSetting" SET value = to_jsonb(GREATEST((("value" #>> '{}')::int) - 1, 0)) WHERE "restaurantId" = ${rid} AND key = ${monthKey(today)}`;
}

/** How many questions this month has used. */
export async function assistantUsed(db: Db): Promise<number> {
  const row = await db.whSetting.findFirst({ where: { key: monthKey(baghdadDate()) }, select: { value: true } });
  return typeof row?.value === 'number' ? row.value : 0;
}

/**
 * Answers one question. The tables always come back; the model's phrasing comes with them only when there is a provider,
 * allowance is left, the call worked and every figure it wrote is in the tables. Nothing here writes to the books.
 */
export async function askAssistant(run: Run, env: { rid: string; user: { id: string; role: 'OWNER' | 'PARTNER' | 'REP' }; locale: Locale }, question: string): Promise<AssistantAnswer> {
  const today = baghdadDate();
  const used = await run(assistantUsed);
  const tools = toolsFor(question);
  const provider = await resolveAiProvider(getPrisma());
  const named = itemsNamed(question, await run((tx) => tx.whItem.findMany({ where: { active: true }, select: { id: true, names: true } }) as Promise<{ id: string; names: Names }[]>));
  if (tools.length === 0 && named.length === 0 && !provider) return { text: null, tables: [], period: null, degraded: 'NO_TOOL', used };
  const period: AssistantPeriod = periodFor(question);
  const range = periodRange(period, today, addDays);
  const tables = await run(async (tx) => {
    const made = await Promise.all(tools.map((tool) => runTool(tx, tool, { locale: env.locale, period: range, user: env.user })));
    return named.length > 0 ? [...made, await itemTable(tx, named, env.locale)] : made;
  });
  const shown = { tables, period: tools.some((x) => x === 'profit' || x === 'sales') ? range : null };

  if (!provider) return { text: null, ...shown, degraded: 'NO_AI', used };
  const taken = await run((tx) => reserve(tx, env.rid, env.user.id, today));
  if (taken === null) return { text: null, ...shown, degraded: 'LIMIT', used };

  const agent = await askAgent(provider, run, { locale: env.locale, today, user: env.user }, question);
  if (!agent.ok) {
    if (agent.reason === 'PROVIDER_ERROR') await run((tx) => release(tx, env.rid, today));
    // the code's own tables answer when it has some; otherwise whatever the tools returned
    return { text: null, tables: shown.tables.length > 0 ? shown.tables : agent.tables, period: shown.tables.length > 0 ? shown.period : null, degraded: agent.reason, used: agent.reason === 'PROVIDER_ERROR' ? used : taken };
  }
  return { text: agent.text, tables: agent.tables, period: null, used: taken };
}
