'use server';

import { invokeCl } from '@/server/clinic/access';
import * as loyalty from '@/server/clinic/actions/loyalty';

export async function getLoyaltySettings(input: unknown) {
  return invokeCl(loyalty.getLoyaltySettings, input);
}

export async function saveLoyaltySettings(input: unknown) {
  return invokeCl(loyalty.saveLoyaltySettings, input);
}

export async function getHouseholdCard(input: unknown) {
  return invokeCl(loyalty.getHouseholdCard, input);
}

export async function redeemReward(input: unknown) {
  return invokeCl(loyalty.redeemReward, input);
}
