import { z } from 'zod';
import { baghdadDate } from '@/server/domain/wholesale/rates';
import { canWh } from '@/server/domain/wholesale/permissions';
import { achievedOf, isMonth, monthProgress, monthRange, percentOf, type SaleFact } from '@/server/domain/wholesale/targets';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { plain } from '@/server/wholesale/plain';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Each rep's targets for a month and how far his posted sales have gone toward them. A partner sees every active rep; a rep sees
 * only himself. `last` is the most recent earlier target, so the form can start from last month's numbers.
 */
export const repTargetsQuery = defineQuery({
  name: 'wh.targets',
  permission: null,
  wh: 'sale.create',
  input: whPlaceInput.extend({ month: z.string().refine(isMonth).optional() }),
  target: whTargetOf,
  run: async (ctx, input) => {
    if (!ctx.wh || !ctx.scoped) throw new Error('A wholesale query ran without a wholesale actor');
    const db = ctx.scoped;
    const user = { id: ctx.wh.userId, role: ctx.wh.role };
    const today = baghdadDate();
    const month = input.month ?? today.slice(0, 7);
    const { from, to } = monthRange(month);
    const partner = canWh(user.role, 'report.view');
    const reps = await db.whStaff.findMany({
      where: { role: 'REP', deactivatedAt: null, ...(partner ? {} : { userId: user.id }) },
      select: { userId: true, user: { select: { name: true } } },
    });
    const ids = reps.map((r) => r.userId);
    if (ids.length === 0) return plain({ month, progress: monthProgress(today, month), reps: [] });
    const [targets, earlier, sales] = await Promise.all([
      db.whRepTarget.findMany({ where: { userId: { in: ids }, month }, include: { items: true } }),
      db.whRepTarget.findMany({ where: { userId: { in: ids }, month: { lt: month } }, orderBy: { month: 'desc' }, include: { items: true } }),
      db.whSale.findMany({
        where: { status: 'POSTED', userId: { in: ids }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        select: { userId: true, journalEntryId: true, lines: { select: { itemId: true, qtyBase: true, item: { select: { baseUnit: true } } } } },
      }),
    ]);
    const entryIds = sales.map((s) => s.journalEntryId).filter((x): x is string => !!x);
    const journal = entryIds.length ? await db.whJournalLine.findMany({ where: { entryId: { in: entryIds }, account: { code: 'SALES' } }, select: { entryId: true, baseIqd: true } }) : [];
    const sold = new Map(journal.map((l) => [l.entryId, Number(l.baseIqd.toString())]));
    const itemIds = [...new Set([...targets, ...earlier].flatMap((t) => t.items.map((i) => i.itemId)))];
    const itemRows = itemIds.length ? await db.whItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, names: true, baseUnit: true } }) : [];
    const itemOf = new Map(itemRows.map((i) => [i.id, i]));
    const shape = (t: (typeof targets)[number] | undefined) =>
      t
        ? {
            amountIqd: t.amountIqd ? Number(t.amountIqd.toString()) : null,
            weightKg: t.weightKg ? Number(t.weightKg.toString()) : null,
            pieces: t.pieces ? Number(t.pieces.toString()) : null,
            items: t.items.map((i) => ({ itemId: i.itemId, names: (itemOf.get(i.itemId)?.names ?? null) as { ckb: string; ar: string; en: string } | null, baseUnit: (itemOf.get(i.itemId)?.baseUnit ?? 'PIECE') as string, qtyBase: Number(i.qtyBase.toString()) })),
          }
        : null;
    const rows = reps.map((r) => {
      const facts: SaleFact[] = sales
        .filter((s) => s.userId === r.userId)
        .map((s) => ({ amountIqd: s.journalEntryId ? (sold.get(s.journalEntryId) ?? 0) : 0, lines: s.lines.map((l) => ({ itemId: l.itemId, baseUnit: l.item.baseUnit as string, qtyBase: Number(l.qtyBase.toString()) })) }));
      const done = achievedOf(facts);
      const target = shape(targets.find((t) => t.userId === r.userId));
      return {
        userId: r.userId,
        name: r.user.name ?? '',
        target,
        last: target ? null : shape(earlier.find((t) => t.userId === r.userId)),
        done,
        percent: target
          ? {
              amountIqd: percentOf(done.amountIqd, target.amountIqd),
              weightKg: percentOf(done.weightKg, target.weightKg),
              pieces: percentOf(done.pieces, target.pieces),
              items: Object.fromEntries(target.items.map((i) => [i.itemId, percentOf(done.items[i.itemId] ?? 0, i.qtyBase)])),
            }
          : null,
      };
    });
    return plain({ month, progress: monthProgress(today, month), reps: rows });
  },
});
