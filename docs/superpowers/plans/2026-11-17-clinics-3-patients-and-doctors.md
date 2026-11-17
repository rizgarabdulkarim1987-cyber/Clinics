# Clinics 3: patients and doctors

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** the clinic has one patient file (people grouped into households by phone) and its doctors have a profile with a speciality, weekly working hours and a fee list.

**Architecture:** five new clinic-scoped tables, two action modules on Clinics' own framework (`defineClAction`), two screens in the clinic app (`patients`, `doctors`) added to `roles.ts`.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (first slice item 3, "Household account").

## Global Constraints

- Own tables `Cl*`, restaurant-scoped; no shared tables with another product. Messages in en, ar, ckb with identical keys; no other product's name in clinic messages.
- Patient data (name, phone, birth year) never enters an audit row: audit rows for patients carry an entity id and no `changes`.
- Receptionist and owner see patients; only the owner edits doctors; a doctor profile belongs to a `ClMember` of role DOCTOR of the same clinic.
- Phone numbers are stored as digits only, `+964`/`00964`/`964` written as a leading `0`.

## Review Focus

- A patient of clinic B never reachable from clinic A (get, update, search).
- Two patients with one phone share a household; a household is per clinic.
- Doctor hours that overlap or end before they start are refused.
- Audit rows never carry a patient's name or phone.
- A DOCTOR or CASHIER role refused on patient actions.

### Task 1: schema and registry
Tables: `ClHousehold(restaurantId, phone unique per clinic)`, `ClPatient(restaurantId, householdId, name, phone, birthYear?)`, `ClDoctor(restaurantId, memberId unique, speciality, active)`, `ClDoctorHours(doctorId, weekday 0-6, startMin, endMin)`, `ClDoctorFee(doctorId, label, amount Int dinar, sortOrder)`. Migration `20261126100200_clinic_patients_doctors`. Register all five in `RESTAURANT_SCOPED_MODELS`.
Test: `tests/clinic/schema.test.ts` extended (tables exist, unique household per clinic).

### Task 2: patients actions
`src/server/clinic/phone.ts` `normalizePhone`. `src/server/clinic/actions/patients.ts`: `searchPatients`, `createPatient`, `updatePatient`, `getPatient` (with household members), roles OWNER and RECEPTION.
Test: `tests/clinic/patients.test.ts`.

### Task 3: doctors actions
`src/server/clinic/actions/doctors.ts`: `listDoctors` (OWNER, RECEPTION), `saveDoctorProfile`, `saveDoctorHours` (replaces the week), `saveDoctorFees` (replaces the list); owner only.
Test: `tests/clinic/doctors.test.ts`.

### Task 4: screens, roles, messages, audit labels
`roles.ts` screens `patients` and `doctors`; pages and client screens; actions forwarders; messages in three languages; audit action and entity labels.
Verification: clinic tests, words guard, messages test, typecheck, eslint; commit and push.
