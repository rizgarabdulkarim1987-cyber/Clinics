import 'dotenv/config';
import { Client } from 'pg';
import { copyCompany } from '@/server/wholesale/migration/copy-company';
import { describeDatabase } from './database-target';

/**
 * Copies a company out of the standalone Wholesale system into a company of this application:
 *
 *   npm run wholesale:copy -- --restaurant <restaurantId>            (dry run: copies, checks, rolls back)
 *   npm run wholesale:copy -- --restaurant <restaurantId> --apply    (keeps the copy)
 *
 * `DATABASE_URL` is this application's database; `SOURCE_DATABASE_URL` is the standalone system's. Neither is ever printed.
 * Options: `--source-schema <name>` (default `public`), `--allow-unmapped` (keep the old id of a person with no account here).
 * Every person in the old system needs an account here with the same email first; the dry run lists who does not.
 * While it runs, the copied tables are locked against writes: run it when the company is not working.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const restaurantId = arg('restaurant');
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!restaurantId || !sourceUrl || !targetUrl) {
    console.error('Needs --restaurant <id>, SOURCE_DATABASE_URL and DATABASE_URL.');
    process.exitCode = 1;
    return;
  }
  console.log(`Target database: ${describeDatabase()}`);
  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  try {
    const report = await copyCompany(source, target, { restaurantId, sourceSchema: arg('source-schema'), apply: flag('apply'), allowUnmapped: flag('allow-unmapped') });
    for (const t of report.tables) console.log(`${t.table.padEnd(22)} ${String(t.source).padStart(7)} -> ${String(t.copied).padStart(7)}`);
    for (const c of report.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
    console.log(report.applied ? 'Applied.' : report.ok ? 'Dry run only: nothing was kept. Add --apply to keep it.' : 'Checks failed: nothing was kept.');
    if (!report.ok) process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
