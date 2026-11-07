'use server';

import * as wholesale from '@/server/studio/actions/wholesale';
import { invoke } from '@/server/studio/framework/invoke';

export async function setWholesaleLink(input: unknown) {
  return invoke(wholesale.setLink, input);
}
