# Clinics 7: the doctor's share, the till shift, the daily close and reports

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** the owner says how each doctor is paid (a percentage, a fixed sum per visit, or a daily rent the doctor pays the clinic); the till has a shift with an opening float and a daily close that compares counted cash with what the payments say it should be; the owner reads a day report and a doctor-share report.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (doctor share, till, shift, daily close, reports).

## Global Constraints

- Own tables `Cl*`. Money is whole dinars; dollars are cents. Change is always in dinar.
- One open shift per clinic, enforced by a partial unique index, not only by a check.
- A payment joins the open shift if there is one; a payment taken with no shift open is allowed and shows in the day report as "no shift" (ruling: not blocking the till).
- The drawer's expected dinars = opening float + dinars handed over in dinar payments − all change given (dinar change on dollar payments leaves the dinar drawer too). Expected dollars = dollars handed over.
- Share is computed from what was actually collected (`ClBill.paid`), never from the billed total.
- Reports are the owner's alone. No clinical text anywhere.
- Messages in en, ar, ckb, identical keys; no other product's name.

## Review Focus

- A second shift cannot be opened while one is open, even by two clicks at once.
- Closing a closed shift is refused; closing twice never writes two results.
- A dollar payment's change leaves the dinar drawer in the expected figure.
- Percent never gives the doctor more than was collected; rent never takes more than was collected.
- A report range over a year is refused.

### Task 1: schema
`ClDoctor.shareMode/shareValue`, `ClShift`, `ClPayment.shiftId`, partial unique index; migration `20261126100600_clinic_share_shift`.

### Task 2: share, shifts, reports (server)
`saveDoctorShare` in `actions/doctors.ts`; `actions/shifts.ts` (`currentShift`, `openShift`, `closeShift`, `listShifts`); `actions/reports.ts` (`dayReport`, `doctorShares`); `takePayment` joins the open shift. Test `shifts-reports.test.ts`.

### Task 3: screens
A shift panel on Payments; the Reports screen (owner); share fields on the Doctors screen; messages and audit labels.
