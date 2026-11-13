# Clinics: a project of its own in Buzzify Core

Date: 2026-11-13. Status: design written from the owner's brief and two research passes; the owner delegated every
decision not listed under "Decided by the owner" to the builder, so those are marked **(my call)**.

## Intent

Clinics and Beauty centres are two new Buzzify projects, each its own card on the Super Admin hub, next to Menu and Cashier,
Pharmacy, Retail and Wholesale. This document is Clinics only; Beauty is the next project and follows the same shape.

The owner wants nothing to mix: not data, not screens, not permissions, not logins. The owner also wants the product to feel
different from usual clinic software, and the people at a clinic are not one person: the owner, the receptionist, the
cashier and one or more doctors share the premises and each sees something different.

## Decided by the owner

- Clinics and Beauty are two separate projects, built one after the other. Clinics first (the owner left the order to the builder).
- Nothing mixes. Sign-in is separate for each project.
- The software has to be different from the familiar clinic program; the cashier and the doctor are different people; a clinic
  may have several doctors, who share some details.

## Goals

1. A clinic runs a whole day in it: patients arrive (booked or walk-in), wait, see a doctor, are billed and pay, and the
   cashier closes the till.
2. Several doctors in one clinic, one patient file for the clinic, each visit belonging to one doctor.
3. Each role sees only its own work (receptionist, cashier, doctor, nurse, manager, owner).
4. Arabic, Kurdish (Sorani) and English with right-to-left done properly; Iraqi dinar and US dollar.
5. A Super Admin can create, bill and support clinics from the hub, in a space of their own.

## Non-goals (first slice)

- Sending WhatsApp or SMS (the repo has none; it is a later project of its own).
- Insurance, e-prescription to pharmacies, lab or imaging integrations, telemedicine, a patient app (the booking page is in scope, see below).
- Beauty features (packages, commission, before/after photos). They belong to the Beauty project.
- Card payment gateways. Payments are recorded by hand, as everywhere else in Core.

## Anti-goals

- A clinic business seeing a Beauty, Pharmacy, Menu or Retail screen, row, audit line or announcement, or the reverse.
- Patient health data in audit lines, logs, exports or AI prompts.
- A slow reception screen: the front desk must never wait on a form for a walk-in.

## The shape (my call, following Pharmacy, the closest project built in this repo)

- **Sector and space.** A new business sector `CLINIC` and a space `clinic` (address prefix `/studio/clinic`), a billing
  application `clinic`, tables prefixed `Cl*`. Beauty will get `BEAUTY`, `beauty`, `Bt*`. Nothing is shared by sector or prefix.
- **Staff app** at `/clinic`, with its own layout, tokens, gate, actor, place cookie and permission matrix, copied in shape
  from `src/server/pharmacy`. Every clinic action checks the sector and the `clinic` subscription and refuses any other
  business. A test proves no other sector's action can read a `Cl*` model and the reverse.
- **Sign-in is its own.** The clinic app has its own sign-in page and host-only session cookie. An account can enter the
  clinic app only if it holds a clinic role in a clinic business; an account with no clinic role is refused there however
  valid its password. Same for Beauty. (My call: one user store with a per-project gate, not separate user tables; the
  owner's rule "separate logins" is met by the gate and the host-only cookies. If separate user tables are wanted, that is
  a larger change and is raised before it is built.)
- **Roles** `ClRole`: OWNER, MANAGER, RECEPTIONIST, CASHIER, DOCTOR, NURSE. A `ClStaff` row per person per clinic and a
  `ClStaffBranch` row per branch, as in Pharmacy. A pure function gives each role its navigation; a permission check guards
  every action. A doctor sees their own schedule, their own visits and their own earnings; the cashier sees bills and money,
  never clinical text; the receptionist sees the day and the patients' contact details, never clinical text.
- **Records.** One patient file per clinic (`ClPatient`, linked to a household by phone); each visit (`ClVisit`) belongs to
  one doctor; clinical notes are private to the doctor who wrote them unless the clinic's setting shares them. Every read of
  a clinical note is logged. The audit writer refuses patient fields, as Pharmacy's does.

## The first slice (what the plan builds)

1. **Foundation:** sector, space, billing application, hub card, Studio pages to create, list, bill and open a clinic,
   provisioning, messages in three languages, and the separation tests.
2. **Staff app shell and roles:** sign-in, branch selection, role navigation, staff management.
3. **Patients and doctors:** patient file and household, doctors with working hours and their fee list.
4. **The day board (reception home):** one live board with columns Waiting, With the doctor, To pay, Done; a walk-in is a
   token and two taps; a booked patient is checked in with one tap. Booking is a calendar per doctor with no-show state.
5. **Visit and bill:** the doctor writes a short note (templates, no long form), ends the visit; a draft bill appears at the
   cashier already priced from that doctor's fee list; the cashier takes the money in one or more payments, in dinar or
   dollar with change in dinar, and may leave a balance as a debt with a due date.
6. **Doctor share:** a rule per doctor (percentage, fixed share, or clinic rent per session) and a monthly statement.
7. **Till and reports:** shift, cash in and out, daily close with a cash count per currency, per-doctor and per-day reports.

Order inside the slice is foundation first and each later step shippable on its own.

## Added by the owner on 2026-11-13 (required, not optional)

1. **Booking.** A real booking system, not only a day list: a calendar per doctor, services with durations, slots that cannot
   be double booked, a waiting list that fills a cancelled slot, no-show state with an optional deposit, reschedule, and a
   booking page a patient can open from a link or QR code (no sending; WhatsApp sending stays a later project).
2. **Distribution to doctors.** A walk-in or a booking with "any doctor" is routed by a rule the clinic sets: the doctor with
   the shortest wait, the patient's own doctor when they have one, the doctor of the right speciality, or turn by turn. The
   receptionist can always override by moving the token. Doctors can hand a patient on to another doctor in the same file.
3. **Loyalty.** A clinic's own loyalty programme, built in Clinics' own tables (never Menu's loyalty tables) on the idea
   already shipped for menus (stamp card): visits or treatments earn stamps, a household shares them, a reward is a free
   follow-up, a discount or a free item, and a referral earns the referrer a reward. Rewards are redeemed at the cashier.
4. **More that is new (my call, from the research; each is a plan of its own, in this order after the first slice):**
   - *Treatment courses:* a bought course of sessions (physio, dental stages, injections) with the sessions left shown as a
     card; each visit ticks one; the same engine will serve Beauty's packages.
   - *The waiting room as a screen:* a TV board of tokens and a live page a patient opens from a QR ("you are third, about
     twenty minutes") that works without any message being sent.
   - *Recall list:* patients who have not come back when they should (follow-up date passed, six months since a check-up),
     one tap to call or open a chat.
   - *Household account:* one phone, several family members, one balance and one stamp card.
   - *Instalments and debts with a due date* and an aged-debts view for the owner.
   - *Doctor's ten-second note:* tap-through templates by complaint so a simple visit takes no typing.
   - *End-of-day ritual:* a guided close of the till per currency with the doctors' shares computed.

## Constraints

- Branch from `origin/main`; migrations are written and tested on a database of the worktree's own, never on the shared one.
- No motion beyond what the cashier rule allows: none in the cashier screens.
- Right-to-left, logical CSS properties, the three message files with identical keys (a test already requires it).
- Arabic and Kurdish text is never split per letter.

## Left to the builder

Table names beyond the prefix, the exact permission list, the visual design of the day board (made with the impeccable and
21st skills), seed data, and the order of the report pages.

## Risks to watch while building

A new sector missed in one of the places that list sectors falls back to Menu and Cashier (audit rows, billing, people,
announcements, pickers, the hub). The plan therefore starts with a checklist of those places and a test that seeds one
business per sector and proves no leakage.
