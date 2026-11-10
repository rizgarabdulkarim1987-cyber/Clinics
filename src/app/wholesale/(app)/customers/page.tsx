import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { cityListQuery, customersQuery, staffQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { CustomerForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Customers' };

type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function CustomersPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const canManage = canWh(actor!.role, 'catalog.manage');
  const [customers, cities, staff] = await Promise.all([queryWh(customersQuery), queryWh(cityListQuery), canManage ? queryWh(staffQuery) : Promise.resolve([])]);
  const cityOptions = cities.map((c) => ({ id: c.id, label: nameOf(c.name, actor!.locale) }));
  const reps = staff.filter((s) => s.role === 'REP').map((s) => ({ userId: s.userId, name: s.name }));
  return (
    <>
      <PageHeader title={t('wh.customers.title')} description={t('wh.customers.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        {canManage && cityOptions.length > 0 && (
          <details className="rounded-md border border-line bg-raised">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.customers.new')}</summary>
            <div className="border-t border-line p-4">
              <CustomerForm cities={cityOptions} reps={reps} />
            </div>
          </details>
        )}
        {customers.length === 0 ? (
          <EmptyState title={t(canManage ? 'wh.customers.empty' : 'wh.customers.emptyRep')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {customers.map((c) => (
              <li key={c.id} className="rounded-md border border-line bg-raised p-4">
                <p className="text-base font-semibold" dir="auto">{c.name}</p>
                <p className="text-sm text-muted" dir="auto">
                  {nameOf(c.city, actor!.locale)}
                  {c.phone ? ` · ${c.phone}` : ''}
                  {c.creditLimitIqd ? ` · ${t('wh.customers.credit')}: ${Number(c.creditLimitIqd).toLocaleString('en-US')}` : ''}
                </p>
                {canManage && (
                  <details className="mt-3 rounded-md border border-line">
                    <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base">{t('wh.common.edit')}</summary>
                    <div className="border-t border-line p-3">
                      <CustomerForm customer={c} cities={cityOptions} reps={reps} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
