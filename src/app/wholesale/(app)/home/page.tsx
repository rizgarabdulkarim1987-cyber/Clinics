import type { Metadata } from 'next';
import Link from 'next/link';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { customersQuery, itemsQuery, warehousesQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { Alert, PageHeader } from '@/studio/ui';
import { SetupButton } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Home' };

/** The first screen. Phase 6 turns it into the smart home screen; for now it counts what the company holds. */
export default async function HomePage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const [items, warehouses, customers] = await Promise.all([queryWh(itemsQuery), queryWh(warehousesQuery), queryWh(customersQuery)]);
  const isRep = actor!.role === 'REP';
  const needsSetup = !isRep && !warehouses.some((w) => w.kind === 'MAIN') && canWh(actor!.role, 'settings.manage');
  const tiles: { label: string; value: number; href: string }[] = [
    { label: t('wh.home.items'), value: items.length, href: '/wholesale/catalog' },
    { label: t('wh.home.warehouses'), value: warehouses.length, href: '/wholesale/stock' },
    { label: t('wh.home.customers'), value: customers.length, href: '/wholesale/customers' },
  ];
  return (
    <>
      <PageHeader title={t('wh.home.hello', { name: actor!.name })} description={isRep ? t('wh.home.repHint') : undefined} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        {needsSetup && (
          <Alert tone="neutral">
            <strong>{t('wh.home.setup')}</strong> {t('wh.home.setupBody')}
            <div className="mt-3">
              <SetupButton />
            </div>
          </Alert>
        )}
        <ul className="grid gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <li key={tile.href}>
              <Link href={tile.href} className="flex min-h-24 flex-col justify-between rounded-md border border-line bg-raised p-4 hover:bg-hover">
                <span className="text-sm text-muted">{tile.label}</span>
                <span className="text-2xl font-semibold tabular-nums" dir="ltr">{tile.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
