'use server';

import * as wholesale from '@/server/studio/actions/wholesale';
import { invoke } from '@/server/studio/framework/invoke';

export async function setWholesaleLink(input: unknown) {
  return invoke(wholesale.setLink, input);
}

export async function createWholesaleClient(input: unknown) {
  return invoke(wholesale.createClient, input);
}

export async function revokeWholesaleClient(input: unknown) {
  return invoke(wholesale.revokeClient, input);
}
