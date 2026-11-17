'use server';

import { invokeCl } from '@/server/clinic/access';
import * as board from '@/server/clinic/actions/board';

export async function loadBoard(input: unknown) {
  return invokeCl(board.loadBoard, input);
}

export async function listArrivals(input: unknown) {
  return invokeCl(board.listArrivals, input);
}

export async function addWalkIn(input: unknown) {
  return invokeCl(board.addWalkIn, input);
}

export async function checkIn(input: unknown) {
  return invokeCl(board.checkIn, input);
}

export async function moveTicket(input: unknown) {
  return invokeCl(board.moveTicket, input);
}

export async function callTicket(input: unknown) {
  return invokeCl(board.callTicket, input);
}

export async function endVisit(input: unknown) {
  return invokeCl(board.endVisit, input);
}

export async function handOver(input: unknown) {
  return invokeCl(board.handOver, input);
}

export async function markLeft(input: unknown) {
  return invokeCl(board.markLeft, input);
}

export async function finishTicket(input: unknown) {
  return invokeCl(board.finishTicket, input);
}

export async function saveDistribution(input: unknown) {
  return invokeCl(board.saveDistribution, input);
}

export async function listTicketFees(input: unknown) {
  return invokeCl(board.listTicketFees, input);
}

export async function listTicketPackages(input: unknown) {
  return invokeCl(board.listTicketPackages, input);
}
