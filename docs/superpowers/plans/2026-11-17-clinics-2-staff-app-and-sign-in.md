# Clinics 2: the staff app, its own sign-in and its roles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, TDD, one whole-branch review at the end). Steps use checkbox syntax.

**Goal:** A clinic's people (owner, receptionist, doctor, cashier) sign in to the clinic app with accounts that exist only for Clinics, and each sees only the screens of their role.

**Architecture:** An in-repo app at `src/app/clinic` (Pharmacy's footprint), served on its own host `CLINIC_HOST`. Unlike Pharmacy it does NOT use the Studio sign-in: Clinics keeps its own account and session tables, so a Pharmacy, Menu or Studio account can never open a clinic and the other way round (owner rule: nothing mixes, completely separate logins). The Studio only creates the clinic and invites its owner (Plan 1); the invitation is accepted on the clinic app's own page.

**Tech Stack:** Next.js App Router, Prisma/Postgres, zod, vitest; the Studio `defineAction`/`defineQuery` framework with a new `cl` target (as Pharmacy has `ph`).

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md`

## Global Constraints

- Own tables: `ClAccount` (email unique, password hash, name, status), `ClSession`, `ClMember` (account, restaurantId, role, branchIds, status). No foreign key to the Studio `User`.
- Roles: `OWNER`, `RECEPTION`, `DOCTOR`, `CASHIER`. A role sees only its screens; the doctor never sees money, the cashier never sees notes (spec: private notes, `sharePrivateNotes`).
- Own cookie `bz_cl_session`, HttpOnly, Lax, host-only, signed; never accepted by another product. Password policy and rate limit reuse the Studio's modules by import, not by sharing sessions.
- Own words: every text through `clinic.*` keys in en/ar/ckb; no restaurant, menu, till, shop or pharmacy word (`tests/studio/clinic-words.test.ts` style guard).
- Every table scoped by `restaurantId` and registered in `RESTAURANT_SCOPED_MODELS`; cross-tenant tests for every action.
- Nothing is pushed to `buzzify-core`; the Clinics repo (`clinics` remote) receives this branch.

## Review Focus

- A Pharmacy/Studio session cookie sent to the clinic host: refused, no clinic data.
- A member of clinic A calling an action with clinic B's id: NOT_FOUND.
- A suspended or archived clinic: sign-in works read-only or is closed, as the gate says; never a crash.
- A doctor opening a cashier URL by hand: refused by the server, not only hidden in the nav.
- Two owners invited with the same email: one account, two memberships.

### Task 1: Accounts, sessions and members (schema)

**Files:** `prisma/schema.prisma`, a migration `20261126100000_clinic_accounts`, `src/server/data/tenant-db.ts`, `tests/clinic/schema.test.ts`.

**Interfaces:** Produces models `ClAccount`, `ClSession`, `ClMember`, enum `ClRole`.

- [ ] Write `tests/clinic/schema.test.ts`: an account with two members in two clinics; a duplicate email is refused; deleting a clinic's member leaves the account.
- [ ] Run it and watch it fail (models missing).
- [ ] Add the models and migration; register `ClMember` as restaurant-scoped.
- [ ] Run the test and `prisma validate`; commit.

### Task 2: Sign-in, sign-out and session

**Files:** `src/server/clinic/auth/{session,password,sign-in}.ts`, `src/app/clinic/(public)/sign-in/page.tsx`, tests.

**Interfaces:** `signInClinic(email, password): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'locked' }>`, `getClinicSession(): Promise<ClSessionView | null>`, `signOutClinic()`.

- [ ] Tests: right password signs in; wrong gives `invalid` with the same timing path; five failures lock; a Studio cookie is not a clinic session; the cookie is host-only.
- [ ] Implement with the Studio password policy/hash and rate-limit modules imported.
- [ ] Sign-in page in the three languages, no other product named.
- [ ] Commit.

### Task 3: Invitations and the owner's first sign-in

**Files:** `src/server/clinic/invitations.ts`, `src/app/clinic/(public)/accept/[token]/page.tsx`, tests.

- [ ] Tests: the owner invitation `provisionClinic` creates (Plan 1) is accepted on the clinic page, creates the `ClAccount` + `OWNER` `ClMember`; a used or expired token is refused; an existing account email gets only a new membership.
- [ ] Implement; the Studio's invitation row is reused, the accepting side is the clinic's own.
- [ ] Commit.

### Task 4: Host, proxy and the `cl` target

**Files:** `src/server/env.ts` (`CLINIC_HOST`, differs from the other hosts), `src/proxy.ts`, `src/server/clinic/actor.ts`, `src/server/clinic/entry.ts`, tests.

**Interfaces:** `getClAccess()`, `clTargetOf(input)`, `clPlaceInput`, entry states `signIn | notFound | closed | readOnly | open` (Pharmacy's `phEntry` shape).

- [ ] Tests for env host clash, proxy routing of the clinic host, and every entry state.
- [ ] Implement by copying Pharmacy's `actor/entry` and replacing its identity with `ClMember`.
- [ ] Register the `cl` target in the action framework and add cross-tenant tests for it.
- [ ] Commit.

### Task 5: Roles, staff screen and the app shell

**Files:** `src/server/clinic/roles.ts`, `src/app/clinic/(app)/{layout,home,staff}/…`, `src/app/clinic/_actions/staff.ts`, `src/studio/messages/clinic/app/*`, tests.

**Interfaces:** `canSee(role, screen): boolean`, `navFor(role): ClNavItem[]`.

- [ ] Tests: each role's nav; a doctor opening `/clinic/cashier` is refused by the server; the owner adds, changes and deactivates staff; the last owner cannot be removed.
- [ ] Implement the shell (RTL first, laptop and phone), the staff screen and role-gated routes.
- [ ] Commit.

### Task 6: Whole-plan check

- [ ] Full suite with `BUZZIFY_DB_PORT=54351`, typecheck, eslint on `src`, browser at 375px and 1366px, `code-review`, fix confirmed findings, push to `clinics`.

## Following plans

3 patients and doctors; 4 booking; 5 day board and distribution; 6 visit, bill, cashier; 7 doctor share, till, reports; 8 loyalty; 9 courses, waiting room, recall list. Beauty centres follow with their own spec.
