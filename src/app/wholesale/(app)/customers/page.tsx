import { ChevronDown, MapPin, Phone, Store, UserRound, UserPlus, Users, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { cityListQuery, customersQuery, staffQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { Chip, Fold } from '../../_ui/Ui';
import { CustomerForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Customers' };

type Names = { ckb: string; ar: string; en: string };
const nameOf = (names: Names, locale: string) => (locale === 'ar' ? names.ar : locale === 'ckb' ? names.ckb : names.en) || names.ckb || names.ar || names.en;

export default async function CustomersPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const canManage = canWh(actor!.role, 'catalog.manage');
  const isRep = actor!.role === 'REP';
  const [customers, cities, staff] = await Promise.all([queryWh(customersQuery), queryWh(cityListQuery), canManage ? queryWh(staffQuery) : Promise.resolve([])]);
  const cityOptions = cities.map((c) => ({ id: c.id, label: nameOf(c.name, actor!.locale) }));
  const reps = staff.filter((s) => s.role === 'REP').map((s) => ({ userId: s.userId, name: s.name }));
  const repName = new Map(reps.map((r) => [r.userId, r.name]));
  const wholesale = customers.filter((c) => c.type === 'WHOLESALE').length;
  return (
    <>
      <PageHeader icon={Store} tone="teal" title={t('wh.customers.title')} description={t('wh.customers.description')} />
      <div className="flex flex-col gap-3 px-4 pb-6 md:px-6">
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Users, tone: 'blue' as const, label: t('wh.customers.title'), value: customers.length },
            { icon: Store, tone: 'violet' as const, label: t('wh.customers.type.WHOLESALE'), value: wholesale },
            { icon: Store, tone: 'amber' as const, label: t('wh.customers.type.MARKET'), value: customers.length - wholesale },
          ].map((k) => (
            <div key={k.label} className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 shadow-[0_1px_2px_rgb(15_42_74/0.06)]">
              <Chip icon={k.icon} tone={k.tone} size="size-11" />
              <div className="min-w-0">
                <div className="truncate text-sm text-muted">{k.label}</div>
                <div className="text-xl font-semibold tabular-nums">{k.value}</div>
              </div>
            </div>
          ))}
        </div>
        {cityOptions.length > 0 && (
          <Fold icon={UserPlus} tone="green" title={t('wh.customers.new')}>
            <CustomerForm cities={cityOptions} reps={reps} isRep={isRep} />
          </Fold>
        )}
        {customers.length === 0 ? (
          <EmptyState title={t(canManage ? 'wh.customers.empty' : 'wh.customers.emptyRep')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line bg-raised md:max-h-[calc(100dvh-19rem)]">
            {customers.map((c) => (
              <li key={c.id}>
                <details className="group">
                  <summary className={`flex list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden ${canManage ? 'cursor-pointer hover:bg-hover' : ''}`}>
                    <Chip icon={Store} tone={c.type === 'WHOLESALE' ? 'violet' : 'amber'} size="size-11" />
                    <span className="grid min-w-0 flex-1 gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-base font-semibold" dir="auto">
                            {c.name}
                          </span>
                          <StatusBadge tone={c.type === 'WHOLESALE' ? 'ink' : 'neutral'}>{t(`wh.customers.type.${c.type}`)}</StatusBadge>
                        </span>
                        {c.ownerName && (
                          <span className="flex items-center gap-1.5 text-sm text-muted" dir="auto">
                            <UserRound aria-hidden className="size-3.5" />
                            {c.ownerName}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5 text-sm text-muted">
                        {c.phone && (
                          <span className="flex items-center gap-1.5" dir="ltr">
                            <Phone aria-hidden className="size-3.5" />
                            {c.phone}
                          </span>
                        )}
                        {c.creditLimitIqd && (
                          <span className="flex items-center gap-1.5" dir="ltr">
                            <Wallet aria-hidden className="size-3.5" />
                            {Number(c.creditLimitIqd).toLocaleString('en-US')}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5 text-sm text-muted">
                        <span className="flex items-center gap-1.5" dir="auto">
                          <MapPin aria-hidden className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {nameOf(c.city, actor!.locale)}
                            {c.address ? ` · ${c.address}` : ''}
                          </span>
                        </span>
                        {canManage && c.repId && repName.get(c.repId) && (
                          <span className="flex items-center gap-1.5 text-wh-teal" dir="auto">
                            <UserRound aria-hidden className="size-3.5" />
                            {repName.get(c.repId)}
                          </span>
                        )}
                      </span>
                    </span>
                    {canManage && <ChevronDown aria-hidden className="size-4 shrink-0 text-muted group-open:rotate-180" />}
                  </summary>
                  {canManage && (
                    <div className="border-t border-line bg-bg p-4">
                      <CustomerForm customer={c} cities={cityOptions} reps={reps} />
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
