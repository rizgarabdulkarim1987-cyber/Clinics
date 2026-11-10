import type { Metadata } from 'next';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { staffQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { AddStaffForm, StaffActions } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'People' };

export default async function StaffPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const staff = await queryWh(staffQuery);
  return (
    <>
      <PageHeader title={t('wh.staff.title')} description={t('wh.staff.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.staff.addTitle')}</summary>
          <div className="border-t border-line p-4">
            <AddStaffForm />
          </div>
        </details>
        {staff.length === 0 ? (
          <EmptyState title={t('wh.staff.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {staff.map((s) => (
              <li key={s.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-raised p-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold" dir="auto">{s.name}</p>
                  <p className="text-sm text-muted" dir="ltr">{s.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone={s.role === 'REP' ? 'neutral' : 'ink'}>{t(`wh.role.${s.role}`)}</StatusBadge>
                  {s.role === 'REP' && <span className="text-sm text-muted">{s.warehouseId ? t('wh.staff.warehouse') : t('wh.staff.noWarehouse')}</span>}
                  {s.role === 'REP' && (
                    <Link href="/wholesale/targets" className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-sm font-semibold hover:bg-hover">
                      {t('wh.target.edit')}
                    </Link>
                  )}
                  <StaffActions userId={s.userId} role={s.role} hasWarehouse={Boolean(s.warehouseId)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
