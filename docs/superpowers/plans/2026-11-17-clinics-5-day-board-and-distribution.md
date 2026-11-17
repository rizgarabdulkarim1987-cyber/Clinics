# Clinics 5: the day board and distribution to doctors

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD, one whole-branch review at the end.

**Goal:** one live board for the clinic's day (Waiting, With the doctor, To pay, Done); a walk-in is a token and two taps; a booked patient is checked in with one tap; walk-ins are routed to a doctor by the clinic's rule; the receptionist can always move a token; a doctor can hand a patient to another doctor.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md` (first slice item 4, owner addition 2).

## Global Constraints

- Own tables `Cl*`. A ticket belongs to one clinic day (Baghdad date) and is numbered 1, 2, 3 from the day's start; the number is unique per clinic and day.
- Rules (set by the owner, kept in `ClSettings`): `SHORTEST_WAIT` (fewest open tickets), `OWN_DOCTOR` (the patient's last doctor, else shortest wait), `SPECIALITY` (doctor of the asked speciality, else shortest wait), `TURN` (next doctor in turn). Only doctors who are active, whose person is active and who work at that moment are candidates; when nobody is on duty, every active doctor is.
- Roles: the owner and receptionist see and move every token; a doctor sees only their own and may call, end and hand over their own; the one who takes payments sees To pay and Done only.
- No clinical text on the board. Audit rows carry ids only.
- Messages in en, ar, ckb with identical keys; no other product's name.

## Review Focus

- Two walk-ins at once never get the same number.
- A doctor never sees or changes another doctor's ticket.
- Routing never picks an inactive doctor or a doctor of another clinic.
- A token already past Waiting cannot be moved or handed over by a stale click.
- The cashier role never sees a waiting patient.

### Task 1: schema, rule and routing
`ClTicket`, `ClTicketStatus`, `ClDistribution`, columns on `ClSettings`; `booking/routing.ts` `routeDoctor`. Tests `routing.test.ts`.

### Task 2: ticket actions
`actions/board.ts`: `checkIn`, `addWalkIn`, `moveTicket`, `callTicket`, `endVisit`, `handOver`, `markLeft`, `finishTicket`, `loadBoard`, `saveDistribution`. Test `board.test.ts`.

### Task 3: screens
`board` screen for every role with polling, walk-in and check-in controls, rule select on the Doctors screen; messages and audit labels.
