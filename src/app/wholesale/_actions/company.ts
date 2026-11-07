'use server';

import * as catalog from '@/server/wholesale/actions/catalog';
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
