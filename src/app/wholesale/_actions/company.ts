'use server';

import * as assistant from '@/server/wholesale/actions/assistant';
import * as books from '@/server/wholesale/actions/books';
import * as catalog from '@/server/wholesale/actions/catalog';
import * as purchase from '@/server/wholesale/actions/purchase';
import * as sale from '@/server/wholesale/actions/sale';
import * as treasury from '@/server/wholesale/actions/treasury';
import { invokeWh } from '@/server/wholesale/access';

// The Wholesale screens' Server Actions. `invokeWh` puts in the company the person works in; the browser never names it.

export async function createItem(input: unknown) {
  return invokeWh(catalog.createItemAction, input);
}

export async function updateItem(input: unknown) {
  return invokeWh(catalog.updateItemAction, input);
}

export async function setPrices(input: unknown) {
  return invokeWh(catalog.setPricesAction, input);
}

export async function saveCustomer(input: unknown) {
  return invokeWh(catalog.saveCustomerAction, input);
}

export async function saveSupplier(input: unknown) {
  return invokeWh(catalog.saveSupplierAction, input);
}

export async function createRepWarehouse(input: unknown) {
  return invokeWh(catalog.createRepWarehouseAction, input);
}

export async function transferToRep(input: unknown) {
  return invokeWh(catalog.transferToRepAction, input);
}

export async function setStaff(input: unknown) {
  return invokeWh(catalog.setStaffAction, input);
}

export async function deactivateStaff(input: unknown) {
  return invokeWh(catalog.deactivateStaffAction, input);
}

export async function provision() {
  return invokeWh(catalog.provisionAction, {});
}

export async function setRate(input: unknown) {
  return invokeWh(purchase.setRateAction, input);
}

export async function postPurchase(input: unknown) {
  return invokeWh(purchase.postPurchaseAction, input);
}

export async function addLandedCost(input: unknown) {
  return invokeWh(purchase.addLandedCostAction, input);
}

export async function paySupplier(input: unknown) {
  return invokeWh(purchase.paySupplierAction, input);
}

export async function cancelPurchase(input: unknown) {
  return invokeWh(purchase.cancelPurchaseAction, input);
}

export async function returnPurchase(input: unknown) {
  return invokeWh(purchase.returnPurchaseAction, input);
}

export async function postSale(input: unknown) {
  return invokeWh(sale.postSaleAction, input);
}

export async function approveSale(input: unknown) {
  return invokeWh(sale.approveSaleAction, input);
}

export async function rejectSale(input: unknown) {
  return invokeWh(sale.rejectSaleAction, input);
}

export async function cancelSale(input: unknown) {
  return invokeWh(sale.cancelSaleAction, input);
}

export async function collectPayment(input: unknown) {
  return invokeWh(sale.collectPaymentAction, input);
}

export async function returnSale(input: unknown) {
  return invokeWh(sale.returnSaleAction, input);
}

export async function convertCash(input: unknown) {
  return invokeWh(treasury.convertCashAction, input);
}

export async function submitHandover(input: unknown) {
  return invokeWh(treasury.submitHandoverAction, input);
}

export async function confirmHandover(input: unknown) {
  return invokeWh(treasury.confirmHandoverAction, input);
}

export async function rejectHandover(input: unknown) {
  return invokeWh(treasury.rejectHandoverAction, input);
}

export async function postExpense(input: unknown) {
  return invokeWh(treasury.postExpenseAction, input);
}

export async function approveExpense(input: unknown) {
  return invokeWh(treasury.approveExpenseAction, input);
}

export async function rejectExpense(input: unknown) {
  return invokeWh(treasury.rejectExpenseAction, input);
}

export async function closePeriod(input: unknown) {
  return invokeWh(books.closePeriodAction, input);
}

export async function reopenPeriod(input: unknown) {
  return invokeWh(books.reopenPeriodAction, input);
}

export async function saveSettings(input: unknown) {
  return invokeWh(books.saveSettingsAction, input);
}

export async function askAssistant(input: unknown) {
  return invokeWh(assistant.askAssistantAction, input);
}

export async function importOpening(input: unknown) {
  return invokeWh(books.importOpeningAction, input);
}
