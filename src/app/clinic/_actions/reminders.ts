'use server';

import { invokeCl } from '@/server/clinic/access';
import * as reminders from '@/server/clinic/actions/reminders';

export async function listReminders(input: unknown) {
  return invokeCl(reminders.listReminders, input);
}

export async function markReminded(input: unknown) {
  return invokeCl(reminders.markReminded, input);
}

export async function saveReminderText(input: unknown) {
  return invokeCl(reminders.saveReminderText, input);
}
