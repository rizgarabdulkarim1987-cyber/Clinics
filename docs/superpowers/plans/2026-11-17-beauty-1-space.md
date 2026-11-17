# Beauty centres on the clinic engine, with their own logins

> Written after the build, as the record of the rulings (the owner asked for work to continue without questions).

**Goal:** Beauty centres (مراكز التجميل) as a separate product from Clinics: own sign-in, own address (`/beauty`), own words, created and billed from the Studio Super Admin. Booking, specialist routing, bills, loyalty, courses, recall and debts all come from the clinic engine.

**Architecture:** One engine, two spaces. A business stays `sector: CLINIC`; `ClSettings.kind` (CLINIC | BEAUTY) says which product it is. `ClAccount.space` makes logins separate: unique (email, space), so one address can hold a clinic account and a beauty account that never meet. Memberships load only for businesses of the account's space. The space of a request is read from the path (`/beauty/...`, set by `src/proxy.ts` in `REQUEST_PATH_HEADER`); cookies are `bz_cl_session` on `/clinic` and `bz_bt_session` on `/beauty`. `/beauty/*` route files re-export the clinic pages. Words: `src/studio/messages/beauty/*` is laid over the clinic catalog (same keys).

## Rulings
- No new `BusinessSector`: it would break every exhaustive switch in the Studio and duplicate about 3,000 tested lines.
- The clinic and beauty products share the clinic host (`/beauty` is served wherever `/clinic` is); a separate beauty host is not set up.
- A beauty centre keeps no clinical text: `endVisit` refuses a complaint or note from a beauty session (FORBIDDEN) and the panel hides them.
- Public booking and the waiting-room screen open for either kind (they show specialist names and numbers only).
- Studio: the Clinics space's create form has a "Which product" choice; billing and plans of a beauty centre use the clinic plan family for now.

## Tasks (all done)
- [x] Migration `20261126100900_beauty_space` (ClKind, ClSettings.kind, ClAccount.space, unique (email, space)).
- [x] `space.ts`, `request-space.ts`, per-space cookies, sign-in, invitations (link and account by the business's kind), entry, access, nav base, translator.
- [x] `/beauty` routes, root layout, hosts, words (en, ar, ckb), Studio form + `clinicKind` on `restaurants.create`, `provisionClinic({ kind })`.
- [x] Tests: `beauty-space.test.ts` (separate logins, memberships, invitation link, appointment flow, no clinical text), `beauty-words.test.ts` (key parity, host routing).

## Not done
- Browser check at 375px and 1366px (needs a signed-in session in the dev pane).
- A separate beauty host, and beauty-specific plans/billing copy in the Studio.
