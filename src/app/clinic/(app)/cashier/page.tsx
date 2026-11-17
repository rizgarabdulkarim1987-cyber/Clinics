import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { getRate, listBills } from '@/server/clinic/actions/bills';
import { currentShift } from '@/server/clinic/actions/shifts';
import { clinicTranslator } from '@/server/clinic/translator';
import { CashierScreen } from './CashierScreen';
import { ShiftPanel } from './ShiftPanel';

/** Payments: bills from finished visits, for the owner, the receptionist and the one who takes the money. No clinical text is read here. */
export default async function ClinicCashierPage() {
  const { member } = await requireClScreen('cashier');
  const [bills, rate, shift] = await Promise.all([invokeCl(listBills, { status: 'OPEN' }), invokeCl(getRate, {}), invokeCl(currentShift, {})]);
  if (!bills.ok || !rate.ok || !shift.ok) notFound();
  const t = await clinicTranslator();
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.cashier.title')}</h1>
        <p className="text-muted">{t('clinic.app.cashier.intro')}</p>
      </div>
      <ShiftPanel initial={shift.data} />
      <CashierScreen initial={bills.data} initialRate={rate.data.usdRate} canSetRate={member.role === 'OWNER'} />
    </section>
  );
}
