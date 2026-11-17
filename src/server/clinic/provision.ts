import type { ScopedTx } from '@/server/data/tenant-db';
import type { PhCurrency } from '@/server/domain/restaurant-profile';
import { StudioError } from '@/server/studio/framework/result';
import { prepareClInvitation, queueClOwnerMail } from './invitations';
import type { ClSpace } from './space';

/**
 * Sets a new clinic up: its branches, its `ClSettings` row and, when an email is given, the invitation that makes that
 * person its owner. It runs on the transaction of the action that creates the business, so a failure in any step leaves
 * nothing behind. When the platform has priced the `clinic` product, a 14-day trial of its cheapest dinar monthly plan starts too.
 */

const CLINIC_APPLICATION = 'clinic';
const TRIAL_DAYS = 14;

export interface ClinicBranchInput {
  name: string;
  city?: string;
}

export interface ClinicProvisionArgs {
  restaurantId: string;
  branches: readonly ClinicBranchInput[];
  /** The currencies the clinic may price in; the first is its default. */
  currencies: readonly PhCurrency[];
  /** The person to invite as owner. Needs `invitedById` (the Super Admin creating the clinic). */
  ownerEmail?: string;
  invitedById?: string;
  afterCommit?: (fn: () => void) => void;
  /** Which product this business is: a clinic (the default) or a beauty centre. */
  kind?: ClSpace;
}

export async function provisionClinic(tx: ScopedTx, args: ClinicProvisionArgs): Promise<{ branchIds: string[]; invitationId: string | null }> {
  if (args.branches.length === 0) throw new Error('A clinic needs at least one branch');
  if (args.currencies.length === 0) throw new Error('A clinic needs at least one currency');
  const currencies = [...new Set(args.currencies)];

  let invitation: ReturnType<typeof prepareClInvitation> | null = null;
  let inviter: { name: string; locale: string } | null = null;
  if (args.ownerEmail !== undefined) {
    if (!args.invitedById) throw new Error('An owner invitation needs the person sending it');
    const person = await tx.user.findUnique({ where: { id: args.invitedById }, select: { name: true, locale: true, deactivatedAt: true } });
    if (!person || person.deactivatedAt) throw new StudioError('FORBIDDEN');
    inviter = person;
    // A clinic's owner is invited to Clinics' own sign-in, never to the Studio: no Studio user is made or looked at.
    invitation = prepareClInvitation({ email: args.ownerEmail, role: 'OWNER', invitedById: args.invitedById, now: new Date(), space: args.kind ?? 'CLINIC' });
  }

  // A new business starts on a free trial of the plan with the lowest monthly price in dinars. Where the platform has
  // not priced the product yet there is nothing to start, and the business simply runs until Studio sets one up.
  const now = new Date();
  const application = await tx.application.findUnique({ where: { id: CLINIC_APPLICATION }, select: { status: true } });
  const price = application?.status === 'ACTIVE' ? await tx.planPrice.findFirst({ where: { applicationId: CLINIC_APPLICATION, currency: 'IQD', period: 'MONTHLY' }, orderBy: { amountMinor: 'asc' } }) : null;
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

  // One nested write on the business's own row: the platform's transaction refuses top-level writes of
  // restaurant-scoped models (it has no restaurant yet), and this keeps the branches, the settings and the invitation in
  // the same statement set as the business the action just created.
  const written = await tx.restaurant.update({
    where: { id: args.restaurantId },
    data: {
      branches: { create: args.branches.map((branch, sortOrder) => ({ name: branch.name, city: branch.city ?? '', sortOrder })) },
      clSettings: { create: { kind: args.kind ?? 'CLINIC', enabledCurrencies: currencies, defaultCurrency: currencies[0]! } },
      ...(invitation ? { clInvitations: { create: invitation.data } } : {}),
      ...(price
        ? {
            subscriptions: {
              create: {
                applicationId: CLINIC_APPLICATION,
                planCode: price.planCode,
                status: 'TRIAL' as const,
                period: 'MONTHLY' as const,
                currency: 'IQD' as const,
                priceMinor: price.amountMinor,
                trialEndsAt,
                currentPeriodStart: now,
                currentPeriodEnd: trialEndsAt,
                version: 1,
              },
            },
          }
        : {}),
    },
    select: { name: true, branches: { select: { id: true }, orderBy: { sortOrder: 'asc' } }, clInvitations: { select: { id: true } } },
  });
  const branchIds = written.branches.map((branch) => branch.id);

  if (invitation && inviter) {
    queueClOwnerMail({ email: invitation.data.email, url: invitation.url, clinicName: written.name, inviterName: inviter.name, locale: inviter.locale }, args.afterCommit);
  }
  return { branchIds, invitationId: invitation ? (written.clInvitations[0]?.id ?? null) : null };
}
