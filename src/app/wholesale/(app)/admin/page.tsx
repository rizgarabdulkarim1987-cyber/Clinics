import type { Metadata } from 'next';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess } from '@/server/wholesale/access';
import { Hub } from '../../_ui/Hub';
import OpeningPage from '../opening/page';
import SettingsPage from '../settings/page';
import StaffPage from '../staff/page';

export const metadata: Metadata = { title: 'Administration' };

/** Settings, people and opening balances on one screen. */
export default async function AdminPage() {
  const { actor } = await getWhAccess();
  const can = (p: Parameters<typeof canWh>[1]) => canWh(actor!.role, p);
  return <Hub panes={[can('settings.manage') && <SettingsPage key="s" />, can('staff.manage') && <StaffPage key="p" />, can('import.apply') && <OpeningPage key="o" />]} />;
}
