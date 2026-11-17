# Clinics 6: the visit, the bill and the cashier

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** the doctor ends a visit with a short note (tap-through complaint phrases, no long form) and the fees to charge; a bill appears at the cashier already priced from that doctor's fee list; the cashier takes payments in dinar or dollar with change in dinar, or leaves a balance as a debt with a due date.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (first slice items 5, owner additions "debts with a due date" and "doctor's ten-second note").

## Global Constraints

- Own tables `Cl*`. Money is whole dinars (`Int`); a dollar payment is entered in cents and converted at the clinic's rate (`ClSettings.usdRate`, dinars per dollar, default 1500) fixed on the payment row; change is always returned in dinar.
- Clinical text (a visit's complaint and note) is read only by the doctor who wrote it, or any doctor when the clinic's `sharePrivateNotes` is on. The owner, receptionist and cashier never read it. Every read is logged by an audit row carrying ids only; no note text ever enters an audit row.
- The cashier role sees bills, lines and money, never a note. The owner, receptionist and cashier may take payments.
- Messages in en, ar, ckb with identical keys; no other product's name.

## Review Focus

- A payment never takes a bill past paid: the applied amount is capped at the balance and the rest is change.
- A paid or debt bill cannot be edited, and a payment on a paid bill is refused.
- A note is never shown to a receptionist, cashier or owner, nor to another doctor unless the clinic shares notes; each read leaves an audit row.
- Two payments at once never overpay a bill.
- A dollar amount is converted at the rate in force when it is taken, not the rate later.

### Task 1: schema, rate
`ClVisit`, `ClBill`, `ClBillLine`, `ClPayment`, `ClBillStatus`, `ClSettings.usdRate`; migration `20261126100500_clinic_visit_bill`.

### Task 2: ending a visit
`endVisit` writes the visit and the bill from the doctor's fee list; `actions/visits.ts` reads (`getVisit`, `listPatientVisits`) with the privacy rule and read logging. Test `visits.test.ts`.

### Task 3: the cashier
`actions/bills.ts`: `listBills`, `addBillLine`, `removeBillLine`, `takePayment`, `leaveAsDebt`, `saveRate`. Test `bills.test.ts`.

### Task 4: screens
The doctor's end-visit panel on the board; the Cashier screen; the rate setting; messages and audit labels.
