import { z } from 'zod';
import { whPlaceInput, whTargetOf } from '@/server/wholesale/actions/catalog';
import { askAssistant } from '@/server/wholesale/assistant';
import { photoInput, readInvoicePhoto } from '@/server/wholesale/photoEntry';
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

/** Reads a photo of an invoice into lines for the person to check. Writes nothing to the books; counts against the monthly allowance. */
export const readInvoicePhotoAction = defineAction({
  name: 'wh.assistant.photo',
  permission: null,
  wh: 'ai.use',
  input: whPlaceInput.extend({ photo: photoInput }),
  target: whTargetOf,
  run: async (ctx, { restaurantId, photo }) => {
    if (!ctx.wh) throw new Error('A wholesale action ran without a wholesale actor');
    const reading = await readInvoicePhoto((fn) => ctx.transaction(fn), { rid: restaurantId, user: { id: ctx.wh.userId }, locale: ctx.wh.locale }, photo);
    return plain(reading);
  },
});
