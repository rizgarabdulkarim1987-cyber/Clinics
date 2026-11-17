'use server';

import { invokeCl } from '@/server/clinic/access';
import * as recall from '@/server/clinic/actions/recall';

export async function listRecall(input: unknown) {
  return invokeCl(recall.listRecall, input);
}
