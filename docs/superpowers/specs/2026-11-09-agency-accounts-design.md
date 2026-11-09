# Agency accounts: simple income and expense book for Buzzify

Date: 2026-11-09. Owner: Rizgar. Written from the conversation; the owner asked to build straight away, so this is the short version of the design.

## Why

Rizgar sells services through Buzzify (social media, websites, accounting systems, ad campaigns, commissions, printing) and sometimes buys things (freelancers, camera gear, subscriptions, paid ads). He has never kept books and the work is turning into a side business, so nothing can depend on him remembering. He wants to see, by client, by month and by year, what he earned, spent and kept. It is not a pharmacy or restaurant ledger: no stock, no invoices, no tax.

## What it is

One screen with two tabs, Super Admin only.

- **Entry (default tab):** add a movement in a few seconds (income or expense, amount, currency, client, service, date defaulting to today, optional note); add a new client by name (the slug is made from the name); this month's totals; the latest movements.
- **Reports tab:** pick a month, a year or everything; export to Excel; year view by month; profit per client for the chosen period.

## Decisions made by the owner

- One screen only, no menus of other pages. The only tab is Reports.
- Clients are entered on the same screen; each gets a slug made from its name.
- Amounts are in Iraqi dinar or US dollar, chosen per movement.
- Excel export.
- Intended to be served at `agency.buzzify.tech` (see "Hosting").

## Calls made by the builder (the owner can change these)

- **No conversion between currencies.** Totals are shown per currency (dinar totals, dollar totals). A rate that changes would make a silent conversion wrong; a rate field can be added later.
- **Where it lives:** a Studio area at `/studio/accounts`, gated by the existing `platform.settings` permission (Super Admins only). The same code is what the agency host serves.
- **Money storage** follows billing: integer minor units (`amountMinor`) plus the existing `Currency` enum (IQD has no minor digits, USD has cents). Amount typing reuses `parseAmountInput`.
- **Services are free text** with suggestions (income: social media, website, accounting system, ad campaign, commission, printing; expense: freelancer, equipment, subscription, paid ads, printing).
- **A movement without a client is allowed** (general expenses such as gear and subscriptions); reports show it as its own row.
- **Deleting** a movement or client is an archive (soft delete), shown nowhere but kept for the audit log; an undo toast is out of scope.
- **Slug:** Arabic and Sorani letters are transliterated to Latin, other characters become `-`, repeated slugs get `-2`, `-3`. It can be edited while creating the client and never after.
- Times use the Studio time zone (Asia/Baghdad); a movement has a date, not a time.

## Non-goals

Invoices, VAT, bank reconciliation, multi-user permissions beyond Super Admin, exchange rates, receipts and attachments, recurring entries, charts beyond the year bars.

## Anti-goals

A second screen or a navigation tree. A report that silently mixes dinars and dollars. Losing a movement because of a typo (so archive, never hard-delete).

## Hosting (not decided here)

`agency.buzzify.tech` needs a new host entry in `src/server/http/hosts.ts` (serving only the accounts area and its sign-in), DNS for the subdomain and the production environment setting. This is outward-facing and is done only after the feature works locally and the owner confirms the domain and the target server.
