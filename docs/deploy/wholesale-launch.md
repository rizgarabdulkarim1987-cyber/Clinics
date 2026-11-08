# Wholesale launch checklist

Wholesale is a section of this application (same database, accounts and subscriptions). These steps put it live on its own address and bring the Nare Company's data across. Each step marked **owner** changes production and is done by the owner, not by an automated session.

Nothing here is done by merging alone: a merge to `main` deploys to the VPS, so merge only when you are ready for step 1.

## 1. Merge and deploy (owner)

Merge the `wholesale-in-core` branch to `main`. The deploy runs `prisma migrate deploy`; the migrations are additive (new `Wh*` tables, enums and triggers), nothing existing is changed.

## 2. Give it its address (owner)

1. DNS: an `A` record for `wholesales.buzzify.tech` pointing at the VPS, next to the other product hosts.
2. Environment on the server: `WHOLESALE_HOST=wholesales.buzzify.tech`, then restart. It must differ from every other host (`scripts/check-env.ts` refuses a clash).
3. TLS for the new name, the same way as the other hosts.

Until `WHOLESALE_HOST` is set, `/wholesale` is still served on the Studio host. Once it is set, the Studio host answers 404 for `/wholesale` and the new host serves `/wholesale`, the sign-in and account pages and `/api/auth`. `/` on the new host goes to `/wholesale`.

## 3. Switch the application on (owner)

In the super admin: the `wholesale` application must be ACTIVE, and the company needs a `wholesale` subscription. A lapsed subscription gives a read-only period (see `WH_RETENTION_DAYS`) and then closes the company; it is enforced for every Wholesale action and screen already.

## 4. Create the company's accounts (owner)

Create the company as a WHOLESALE restaurant, with its two partners (Studio owner membership, or staff rows) and the rep as users here, using the same email each person has in the old system. The copy matches people by email and stops, naming them, if one has no account.

## 5. Bring the Nare data across (owner, with a dry run first)

Run when the company is not working: the copied tables are locked against writes until the copy finishes.

```bash
npm run wholesale:copy -- --restaurant <restaurantId>
```

This is a dry run: it copies everything inside one transaction, checks it and rolls back, printing a count per table and these checks: every person matched, every table copied in full, journal totals equal to the old books, every entry balanced, stock on hand equal. When all say `ok`:

```bash
npm run wholesale:copy -- --restaurant <restaurantId> --apply
```

`DATABASE_URL` is this application's database and `SOURCE_DATABASE_URL` is the standalone system's (read only; nothing is written to it). The target company must be empty of Wholesale data (a company that was only set up is fine: its starting chart, warehouses and cities are replaced by the copied ones).

What changes in the copy: document numbers, the stock movement order and period event ids are given new numbers in the old order (they are unique across the whole application). The old sign-in data and audit log are not carried.

## 6. Check, then retire the old system (owner)

Open the home screen and reports for the company and compare cash, debts and stock value with the old system's. Keep the old deployment untouched (read only) until you are satisfied; its Docker deploy files are obsolete once this is live.
