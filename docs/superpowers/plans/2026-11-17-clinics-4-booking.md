# Clinics 4: booking

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** a real booking system: services with durations, a calendar per doctor built from the working week, slots that cannot be double booked, reschedule, cancel, no-show with an optional deposit, a waiting list for cancelled slots, and a public booking page opened from a link or QR.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (added by the owner, item 1).

## Global Constraints

- Own tables `Cl*`, clinic-scoped. Times are stored in UTC; the clinic's day is Baghdad time (UTC+3, no daylight saving), kept in one helper.
- A slot is bookable only inside the doctor's working hours and only when no live booking (BOOKED, CHECKED_IN) of that doctor overlaps; a partial unique index on (doctor, start) closes the race.
- Nothing is sent to patients (no messages). Deposit is an amount recorded on the booking; money is taken in a later plan.
- The public page shows doctor names, services and free times only; it shows no patient data and is rate limited per address.
- Messages in en, ar, ckb with identical keys; no other product's name in them.

## Review Focus

- Two bookings for one doctor at overlapping times never both stand (sequential and racing).
- A slot outside the week, in the past, or for another clinic's doctor is refused.
- A cancelled slot is free again and the waiting list for that day is shown.
- The public page never reveals a patient and cannot book another clinic's doctor.
- Audit rows carry booking ids, never a patient's name or phone.

### Task 1: schema and time helper
Tables `ClService`, `ClBooking`, `ClWaitlistEntry`; migration `20261126100300_clinic_booking` with the partial unique index; `src/server/clinic/time.ts`.

### Task 2: services and slots
`actions/services.ts` (list, save); `bookings.ts` `listSlots`. Tests: `services.test.ts`, `slots.test.ts`.

### Task 3: bookings
`createBooking`, `cancelBooking`, `rescheduleBooking`, `markNoShow`, `listDay`, waiting list actions. Test `bookings.test.ts`.

### Task 4: screens
Screens `bookings` (owner, reception) and `services` (owner); messages, audit labels, nav.

### Task 5: public booking page
`/clinic/book/[clinicId]`, public actions for slots and booking, rate limited; test `public-booking.test.ts`.
