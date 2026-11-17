# Clinics 8: loyalty

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** a stamp card the family shares: every fully paid bill earns the household one stamp; a patient brought in by another gives that other's household a bonus when their first bill is paid; at the cashier a full card is spent for a discount line on the bill.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (loyalty: stamp card, household sharing, referral, redeem at cashier). Own tables, not the Core loyalty tables.

## Global Constraints

- Off by default (`ClSettings.loyaltyEnabled`). Defaults when on: 5 stamps fill a card, reward 5,000 IQD, referral bonus 1 stamp.
- The balance is the sum of a ledger (`ClLoyaltyEntry`); a stamp is never stored as a counter that two clicks could overwrite.
- Every entry has a `refKey` unique per clinic (`visit:<billId>`, `referral:<patientId>`, `redeem:<billId>`), so a bill stamps once and a referral pays once.
- The stamps belong to the household (people sharing a phone), not to one patient.
- A redeemed reward is a negative bill line; it cannot be removed afterwards and a bill redeems once.
- Messages in en, ar, ckb, identical keys; no other product's name; no clinical text.

## Review Focus

- Two redeems at once never spend the same stamps (a balance below zero undoes the entry).
- A bill paid in two parts stamps once, when it is fully paid; a zero bill stamps nothing.
- A referral pays only the first time the referred patient's bill is paid, and never to their own household.
- Switching loyalty off stops earning and redeeming but keeps the ledger.
- A reward never takes a bill below what was already paid.

### Task 1: schema
`ClSettings.loyaltyEnabled/loyaltyEvery/loyaltyRewardIqd/referralStamps`, `ClPatient.referredById`, `ClLoyaltyEntry`; migration `20261126100700_clinic_loyalty`.

### Task 2: server
`src/server/clinic/loyalty.ts` (`earnForBill`), `actions/loyalty.ts` (`getLoyaltySettings`, `saveLoyaltySettings`, `getHouseholdCard`, `redeemReward`), `takePayment` earns on settle, `createPatient` takes `referredByPhone`, `removeBillLine` refuses a reward line. Test `loyalty.test.ts`.

### Task 3: screens
Loyalty settings screen (owner); the card and a redeem button on each open bill at Payments; a "referred by phone" field on the patient form; messages and audit labels.
