'use server';

import * as accounts from '@/server/studio/actions/accounts';
import { invoke } from '@/server/studio/framework/invoke';

export async function createAccountClient(input: unknown) {
  return invoke(accounts.createAccountClient, input);
}

export async function addAccountEntry(input: unknown) {
  return invoke(accounts.addAccountEntry, input);
}

export async function updateAccountEntry(input: unknown) {
  return invoke(accounts.updateAccountEntry, input);
}

export async function archiveAccountEntry(input: unknown) {
  return invoke(accounts.archiveAccountEntry, input);
}

export async function setAccountRate(input: unknown) {
  return invoke(accounts.setAccountRate, input);
}
