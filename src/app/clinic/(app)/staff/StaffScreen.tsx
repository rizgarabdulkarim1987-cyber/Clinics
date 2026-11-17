'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { changeStaffRole, inviteStaff, revokeStaffInvitation, setStaffActive } from '@/app/clinic/_actions/staff';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { CopyButton } from '@/studio/ui/CopyButton';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR' | 'CASHIER';
const STAFF_ROLES = ['RECEPTION', 'DOCTOR', 'CASHIER'] as const;

interface Member {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  isSelf: boolean;
}
interface Invitation {
  invitationId: string;
  email: string;
  role: Role;
  expiresAt: string;
}

/** The owner's staff screen: invite by link, change a role, switch a person off or on, withdraw an invitation. */
export function StaffScreen({ members, invitations }: { members: Member[]; invitations: Invitation[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof STAFF_ROLES)[number]>('RECEPTION');

  const run = (task: () => Promise<{ ok: boolean; error?: { message: string } }>, after?: () => void) =>
    start(async () => {
      setProblem(null);
      const result = await task();
      if (!result.ok) {
        setProblem(result.error?.message ?? '');
        return;
      }
      after?.();
      router.refresh();
    });

  const roleOptions = STAFF_ROLES.map((value) => ({ value, label: t(`clinic.app.role.${value}`) }));

  return (
    <div className="flex flex-col gap-8">
      {problem !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {problem || t('clinic.app.staff.failed')}
        </p>
      )}

      <form
        className="flex flex-col gap-4 rounded-md border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            async () => {
              const result = await inviteStaff({ email, role });
              if (result.ok) setLink(result.data.url);
              return result;
            },
            () => setEmail(''),
          );
        }}
      >
        <h2 className="text-lg font-semibold">{t('clinic.app.staff.invite.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('clinic.app.staff.invite.email')}>
            <Input type="email" size="lg" dir="ltr" className="rtl:text-right" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label={t('clinic.app.staff.invite.role')}>
            <Select size="lg" value={role} options={roleOptions} onChange={(event) => setRole(event.target.value as (typeof STAFF_ROLES)[number])} />
          </Field>
        </div>
        <Button type="submit" variant="primary" size="lg" pending={pending} className="sm:self-start">
          {t('clinic.app.staff.invite.submit')}
        </Button>
        {link && (
          <div className="flex flex-col gap-2 rounded-md bg-surface p-3">
            <p className="text-sm text-muted">{t('clinic.app.staff.invite.linkNote')}</p>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate text-sm">{link}</code>
              <CopyButton value={link} />
            </div>
          </div>
        )}
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('clinic.app.staff.members')}</h2>
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {members.map((member) => (
            <li key={member.memberId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {member.name}
                  {member.isSelf && <span className="ms-2 text-sm font-normal text-muted">{t('clinic.app.staff.you')}</span>}
                </p>
                <p className="truncate text-sm text-muted" dir="ltr">{member.email}</p>
                {member.status === 'DISABLED' && <p className="text-sm text-danger">{t('clinic.app.staff.off')}</p>}
              </div>
              {member.isSelf || member.role === 'OWNER' ? (
                <span className="text-sm text-muted">{t(`clinic.app.role.${member.role}`)}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label={t('clinic.app.staff.invite.role')}
                    value={member.role}
                    options={roleOptions}
                    disabled={pending}
                    onChange={(event) => run(() => changeStaffRole({ memberId: member.memberId, role: event.target.value }))}
                  />
                  <Button variant="secondary" disabled={pending} onClick={() => run(() => setStaffActive({ memberId: member.memberId, active: member.status !== 'ACTIVE' }))}>
                    {member.status === 'ACTIVE' ? t('clinic.app.staff.switchOff') : t('clinic.app.staff.switchOn')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {invitations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('clinic.app.staff.pending')}</h2>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {invitations.map((invitation) => (
              <li key={invitation.invitationId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium" dir="ltr">{invitation.email}</p>
                  <p className="text-sm text-muted">{t(`clinic.app.role.${invitation.role}`)}</p>
                </div>
                <Button variant="secondary" disabled={pending} onClick={() => run(() => revokeStaffInvitation({ invitationId: invitation.invitationId }))}>
                  {t('clinic.app.staff.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
