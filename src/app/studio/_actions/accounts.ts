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

export async function addAccountPayment(input: unknown) {
  return invoke(accounts.addAccountPayment, input);
}

export async function archiveAccountPayment(input: unknown) {
  return invoke(accounts.archiveAccountPayment, input);
}

export async function setAccountRate(input: unknown) {
  return invoke(accounts.setAccountRate, input);
}

export async function archiveAccountAttachment(input: unknown) {
  return invoke(accounts.archiveAccountAttachment, input);
}

export async function addAccountRecurring(input: unknown) {
  return invoke(accounts.addAccountRecurring, input);
}

export async function archiveAccountRecurring(input: unknown) {
  return invoke(accounts.archiveAccountRecurring, input);
}

export async function setAccountBudget(input: unknown) {
  return invoke(accounts.setAccountBudget, input);
}

export async function removeAccountBudget(input: unknown) {
  return invoke(accounts.removeAccountBudget, input);
}

export async function createAccountQuote(input: unknown) {
  return invoke(accounts.createAccountQuote, input);
}

export async function decideAccountQuote(input: unknown) {
  return invoke(accounts.decideAccountQuote, input);
}

export async function archiveAccountQuote(input: unknown) {
  return invoke(accounts.archiveAccountQuote, input);
}

export async function setAccountAccountant(input: unknown) {
  return invoke(accounts.setAccountAccountant, input);
}
