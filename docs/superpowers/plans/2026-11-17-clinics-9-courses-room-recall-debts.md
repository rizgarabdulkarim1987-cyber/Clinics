# Clinics 9: courses, the waiting-room screen, the recall list and aged debts

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** the clinic sells a course of sessions (a package) that visits then spend one by one; a public waiting-room page shows token numbers only, with a QR on the desk's board; the desk gets a recall list of patients not seen for a while; the owner and till see debts by how late they are and can move a due day (an instalment is a part payment plus a new date).

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (courses, waiting room screen and QR, recall, instalments and aged debts).

## Global Constraints

- Own tables `Cl*`. Money is whole dinars.
- A package sale is a token in "To pay" with a one-line bill, so it is paid, left as a debt, counted in reports and the day's money exactly like a visit; it is not a visit.
- A session is spent by ending a visit with `packageId`; the decrement is a guarded update (`sessionsLeft > 0`), so the last session is spent once; if the visit then fails the session is given back.
- The waiting-room page and everything it loads carry token numbers and doctor names only: no patient name, phone or note.
- The recall list is the desk's (owner, receptionist); debts are the owner's, receptionist's and till's.
- Messages in en, ar, ckb, identical keys; no other product's name.

## Review Focus

- Two visits at once spending the last session of a package: one only.
- A sold package never lets a patient spend sessions of another patient's package.
- The waiting-room page answers a non-clinic id as not found and shows no patient data.
- A patient with an upcoming booking is not on the recall list.
- A debt due today is not overdue; a debt cannot be moved to a past day or if it is not a debt.

### Task 1: schema
`ClPackage`, `ClPatientPackage`; migration `20261126100800_clinic_courses`; `createTicket` takes a status.

### Task 2: packages (server)
`actions/packages.ts` (`listPackages`, `savePackage`, `sellPackage`, `listTicketPackages`); `endVisit` takes `packageId`. Test `packages.test.ts`.

### Task 3: waiting room, recall, aged debts (server)
`waiting-room.ts` (`loadWaitingRoom`), `actions/recall.ts` (`listRecall`), `actions/reports.ts` (`agedDebts`), `actions/bills.ts` (`rescheduleDebt`). Test `room-recall-debts.test.ts`.

### Task 4: screens
Packages screen; the package choice in the end-visit panel; the public waiting-room page and the desk's QR; Recall screen; Debts screen; messages and audit labels.
