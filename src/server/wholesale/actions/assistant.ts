import { z } from 'zod';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { askAssistant } from '@/server/wholesale/assistant';
import { plain } from '@/server/wholesale/plain';
import { defineAction } from '@/server/studio/framework/action';

/** Asks the accounting assistant (Phase 7). Read-only on the books; it counts against the company's monthly allowance. */
export const askAssistantAction = defineAction({
  name: 'wh.assistant.ask',
  permission: null,
  wh: 'ai.use',
  input: whPlaceInput.extend({ question: z.string().trim().min(1).max(1000) }),
  target: whTargetOf,
  run: async (ctx, { restaurantId, question }) => {
    if (!ctx.wh) throw new Error('A wholesale action ran without a wholesale actor');
    const answer = await askAssistant((fn) => ctx.transaction(fn), { rid: restaurantId, user: { id: ctx.wh.userId, role: ctx.wh.role }, locale: ctx.wh.locale }, question);
    return plain(answer);
  },
});
