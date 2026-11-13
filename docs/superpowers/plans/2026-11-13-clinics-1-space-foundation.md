# Clinics 1: the closed space in Studio (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Super Admin sees a Clinics card on the hub and, behind it, a closed space (overview, clinics, billing, people, announcements, activity, settings) that creates, bills and lists clinics, with nothing of it visible in any other space and nothing of any other space visible in it.

**Architecture:** Follow commit `38598602` ("Wholesale as a fourth closed project space") file for file: it is the exact footprint of adding one more space. Clinics differs from Wholesale only in that it is an in-repo app (its staff app is Plan 2), so it has a small `ClSettings` table instead of a link to an outside system. The word "clinic" replaces "company" in the space's wording.

**Tech Stack:** Next.js (App Router), Prisma and Postgres, zod, vitest, the Studio action/query framework in `src/server/studio/framework`.

**Spec:** `docs/superpowers/specs/2026-11-13-clinics-design.md`

## Global Constraints

- Sector value `CLINIC`; space id `clinic`; address prefix `/studio/clinic`; billing application id `clinic`; table prefix `Cl`.
- Never reuse Pharmacy's, Wholesale's or Retail's ids, messages, cookies or tables for Clinics.
- A new enum value cannot be used in the transaction that adds it: the enum value is its own migration (`ALTER TYPE "BusinessSector" ADD VALUE 'CLINIC'`), the table and the `Application` row are the next one.
- The `clinic` application is seeded `DISABLED`, `sortOrder` 6; plans are `AppPlan` rows, so `planCodesFor('clinic')` is `[]`.
- Messages: `en`, `ar`, `ckb` with identical keys (`tests/studio/messages.test.ts`); right-to-left safe, logical CSS only.
- Migrations are written and tested on the worktree's own database port, never on 54329 (see the worktree-setup note).
- Check `git diff --stat` before each commit for whole-file churn (CRLF trap).

## Review Focus

- A sector missed in one list silently falls back to Menu and Cashier: audit rows, billing rows, people, announcements and pickers of a clinic must never appear in the Food space (test in Task 4).
- A clinic business opened under `/studio/restaurants/<id>` or another space's prefix: it is moved to `/studio/clinic/<id>`, as the other spaces do.
- `createRestaurant` with sector `CLINIC` creates `ClSettings` in the same transaction and audits it without any personal field.
- A clinic cannot be given a Menu, Cashier, Pharmacy, Retail or Wholesale plan, and a Clinics plan cannot be given to another sector's business.
- An announcement with `space: 'clinic'` is read only in the Clinics space.

---

### Task 1: Schema and migrations

**Files:**
- Create: `prisma/migrations/20261113100000_clinic_sector/migration.sql`, `prisma/migrations/20261113100100_clinic_settings/migration.sql`
- Modify: `prisma/schema.prisma` (enum `BusinessSector` at ~2572; new model after it), `src/server/data/tenant-db.ts` (register `ClSettings` where `PhSettings` is registered), `tests/data/tenant-registry.test.ts` if it lists models, `tests/billing/schema.test.ts` (the seeded applications), `tests/helpers/db.ts` if it seeds applications.

**Interfaces:**
- Produces: `BusinessSector` includes `CLINIC`; model `ClSettings { restaurantId String @id; currencies; sharePrivateNotes Boolean @default(false); createdAt; updatedAt }` with a cascade FK to `Restaurant`; `Application` row `clinic` (`name` en "Clinics", ar "العيادات", ckb "کلینیکەکان").

- [ ] **Step 1: Write the failing test.** In `tests/billing/schema.test.ts`, assert the seeded applications include `clinic` with status `DISABLED` and `sortOrder` 6; in the tenant-registry test, assert `ClSettings` is classified as restaurant-confined.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=<own> npx vitest run tests/billing/schema.test.ts tests/data/tenant-registry.test.ts` — expect FAIL.
- [ ] **Step 3: Write the two migrations** (model on `20261104100000_wholesale_sector` and `…100100_wholesale_link`) and the schema; register `ClSettings` in `tenant-db.ts` in the same set as `PhSettings`. Run `npx prisma generate` and apply with the worktree's `DATABASE_URL`.
- [ ] **Step 4: Run the same tests** — expect PASS.
- [ ] **Step 5: Commit** `feat(clinic): clinic sector, ClSettings and the clinic application`.

### Task 2: Domain constants and limits

**Files:**
- Modify: `src/server/domain/restaurant-profile.ts` (`BUSINESS_SECTORS`), `src/server/domain/billing/catalog.ts` (`APPLICATION_IDS`, `planCodesFor`, `DEFAULT_APPLICATIONS`), `src/server/domain/audit-actions.ts`
- Create: `src/server/domain/clinic/limits.ts`
- Test: `tests/domain/clinic-limits.test.ts`, existing billing catalog tests

**Interfaces:**
- Produces: `clinicLimitsSchema` (zod, strict: optional `maxDoctors: positive int`, optional `maxBranches: positive int`), `type ClinicLimits`; audit action `clinic.settings_changed` and entity type `ClSettings`.

- [ ] **Step 1: Write the failing test** `clinicLimitsSchema.parse({})` passes; `{ maxDoctors: 0 }` and `{ other: 1 }` throw.
- [ ] **Step 2: Run** `npx vitest run tests/domain/clinic-limits.test.ts` — FAIL.
- [ ] **Step 3: Implement** the schema (model on `wholesale/limits.ts`) and the constant additions listed above.
- [ ] **Step 4: Run** the test and `npx vitest run tests/billing` — PASS.
- [ ] **Step 5: Commit** `feat(clinic): domain constants, limits and audit names`.

### Task 3: The space registry and scope

**Files:**
- Modify: `src/studio/spaces.ts` (`SpaceId`, `SPACES`, `BUSINESS_BASE`, `spaceOfBusiness`), `src/server/studio/services/space-scope.ts` (`BUSINESS_SPACES`, `SECTORS`, `APPLICATIONS_OF`, the `clinic` branch of `auditSpaceWhere`, and the exclusion of clinic rows from the pharmacy and food branches), `src/studio/nav.ts` (clinic sidebar entries, `safeNextPath`), `src/studio/sector-param.ts`, `src/studio/pickers.ts`, `src/server/studio/queries/{account,people,app-plans}.ts`, `src/server/studio/services/{billing,restaurants}.ts`
- Test: `tests/studio/spaces.test.ts`, `tests/studio/space-scope.test.ts`, `tests/studio/nav.test.ts`

**Interfaces:**
- Consumes: Task 2 constants.
- Produces: `spaceOfBusiness('CLINIC') === 'clinic'`; `businessPath('clinic', id, tab?) === '/studio/clinic/<id>[/<tab>]'`; `sectorOf('clinic') === 'CLINIC'`; `APPLICATIONS_OF.clinic === ['clinic']`; `auditSpaceWhere(db, 'clinic')` returns clinic businesses' rows, `clinic` AppPlans and clinic announcements only.

- [ ] **Step 1: Write the failing tests** extending the three files above: the registry maps the sector, base, prefix and big icon; `spaceOfPath('/studio/clinic/x')` is `clinic`; scope tests seed one business per sector (food, pharmacy, retail, wholesale, clinic) plus an audit row each and assert each space's `auditSpaceWhere` returns exactly its own and none of the others'.
- [ ] **Step 2: Run** `npx vitest run tests/studio/spaces.test.ts tests/studio/space-scope.test.ts tests/studio/nav.test.ts` — FAIL.
- [ ] **Step 3: Implement** by repeating, for `clinic`, every line the Wholesale commit added in these files (`git show 38598602 -- <file>`); then `grep -rn "'wholesale'" src` and confirm every hit has its `clinic` twin or a reason not to.
- [ ] **Step 4: Run** the same tests plus `npx vitest run tests/studio` — PASS.
- [ ] **Step 5: Commit** `feat(clinic): the clinic space in the registry and its scope`.

### Task 4: Create, bill and list clinics (actions, queries, provisioning)

**Files:**
- Create: `src/server/clinic/provision.ts`, `src/server/studio/actions/clinic.ts`, `src/server/studio/queries/clinics.ts`, `src/app/studio/_actions/clinic.ts`
- Modify: `src/server/studio/actions/restaurants.ts` (the provisioning branch near line 127), `src/server/studio/actions/app-plans.ts`, `src/server/studio/actions/support-access.ts`
- Test: `tests/studio/clinic-space.test.ts`, `tests/clinic/sector-separation.test.ts`

**Interfaces:**
- Produces: `provisionClinic(tx: Prisma.TransactionClient, input: ProvisioningInput): Promise<{ restaurantId: string }>` creating `ClSettings` with defaults; query `listClinics` (paged, scoped to sector `CLINIC`); action `updateClinicSettings({ restaurantId, sharePrivateNotes })` audited as `clinic.settings_changed`.

- [ ] **Step 1: Write the failing tests.** `clinic-space.test.ts`: creating a restaurant with sector `CLINIC` creates one `ClSettings` and one audit row with no personal field; `listClinics` returns only clinics. `sector-separation.test.ts` (model on `tests/pharmacy/sector-separation.test.ts` and `tests/retail/sector-separation.test.ts`): a clinic business cannot be given another application's plan and vice versa, `updateClinicSettings` on a non-clinic business throws a `StudioError` conflict, and every Studio list (restaurants, pharmacies, retail, wholesale, billing, people, activity, announcements) excludes the seeded clinic.
- [ ] **Step 2: Run** `npx vitest run tests/studio/clinic-space.test.ts tests/clinic` — FAIL.
- [ ] **Step 3: Implement** `provisionClinic` (model on `provisionPharmacy`), the action and query (model on `actions/wholesale.ts`, `queries/wholesale.ts`), and add the `CLINIC` branch to `createRestaurant` and to the sector guards in `app-plans.ts` and `support-access.ts`.
- [ ] **Step 4: Run** the new tests and `npx vitest run tests/studio tests/billing` — PASS.
- [ ] **Step 5: Commit** `feat(clinic): create, list and bill clinics, closed to the other spaces`.

### Task 5: Pages, forms, badges and messages

**Files:**
- Create: `src/app/studio/(studio)/(app)/clinic/(space)/` with `layout.tsx`, `page.tsx`, `overview/page.tsx`, `new/page.tsx`, `billing/page.tsx`, `people/page.tsx`, `announcements/page.tsx`, `activity/page.tsx`, `settings/page.tsx`, and `[id]/` with `layout.tsx`, `page.tsx`, `billing`, `people`, `activity` (model on `wholesale/(space)/**`); `src/studio/messages/clinic/{en,ar,ckb}.ts`
- Modify: `src/studio/messages/{en,ar,ckb}.ts` (`hub.clinic`), `src/studio/messages/index.ts`, `src/studio/shell/ProjectHub.tsx` and `Sidebar.tsx` (the icon), `restaurants/RestaurantForm.tsx`, `restaurants/new/page.tsx`, `restaurants/SectorBadge.tsx`, `restaurants/[id]/{layout,BusinessLayout}.tsx`, `billing/plans/{AppPlansEditor,page}.tsx`, the filter files the Wholesale commit touched (`ActivityFilters`, `AnnouncementsAdmin`, `BillingList`, `PeopleDialogs`, `PeopleList`, `PeopleManager`)
- Test: `tests/studio/space-words.test.ts`, `tests/studio/messages.test.ts`, `tests/studio/hub.test.ts`, `tests/e2e/super-admin-hub.spec.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: a hub card named by `hub.clinic` leading to `/studio/clinic`; the word guard accepts "clinic" wording and rejects "pharmacy", "drug", "company" in the clinic messages.

- [ ] **Step 1: Write the failing tests**: messages key parity for the new folder; the hub lists a Clinics card whose `home` is `/studio/clinic`; the word guard for the clinic space; an e2e that signs in as Super Admin, opens the card, creates a clinic with the form and sees it in the list and in no other space's list.
- [ ] **Step 2: Run** `npx vitest run tests/studio` and the e2e spec with `E2E_PORT` and `BUZZIFY_DB_PORT` set — FAIL.
- [ ] **Step 3: Implement** the pages and messages from the Wholesale footprint, with the visual treatment of the card and icon through the project's design skills (impeccable then 21st-ui-build); check five big icons still fit a phone-width hub (375px) and fix the layout if not.
- [ ] **Step 4: Run** unit tests, e2e, `npm run typecheck`, `npx eslint src tests` — PASS.
- [ ] **Step 5: Commit** `feat(clinic): the clinic space's pages, hub card and messages in three languages`.

### Task 6: Whole-branch check

**Files:** none new.

- [ ] **Step 1:** `grep -rn "WHOLESALE\|'wholesale'" src tests | grep -vi clinic` and confirm each remaining hit is either Wholesale-only by nature or has a clinic twin; list any gap and fix it.
- [ ] **Step 2:** Run the full suite `BUZZIFY_DB_PORT=<own> npm test`, `npm run typecheck`, `npx eslint src tests`; record failures that are `main`'s own versus new.
- [ ] **Step 3:** Open the hub in the browser pane at 375px and desktop, screenshot the Clinics card, space and creation form; check the console for errors.
- [ ] **Step 4:** Request a code review (`code-review`) on the branch diff; fix confirmed findings.
- [ ] **Step 5: Commit** any fixes `fix(clinic): review findings`.

## Plans that follow (each its own plan, in this order)

2. Staff app shell: sign-in of its own, branch selection, roles `ClRole`, staff management.
3. Patients and doctors.
4. The day board and booking.
5. Visit, bill and cashier.
6. Doctor share and statements.
7. Till, daily close and reports.
Then Beauty, as its own spec.
