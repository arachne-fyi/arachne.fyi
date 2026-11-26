/*
 * Fill the Bazaar price history from SkyCofl, for every item the server tracks.
 *
 *   npm run backfill-prices                  # last 5 years (COFL_BACKFILL_DAYS)
 *   npm run backfill-prices -- --days 365    # further back
 *
 * The server also does this by itself a little after it starts and every 6 hours, so this is
 * only needed to go further back in one go. Stop the server first (both would write index.db).
 * Drops already counted keep the price they were valued at; run `npm run rebuild-index`
 * afterwards to value old drops against the filled-in prices.
 */
import { loadConfig } from '../src/config.ts';
import { createContext } from '../src/context.ts';
import { backfillFromCofl } from '../src/cofl.ts';

const arg = process.argv.indexOf('--days');
const config = loadConfig();
const days = arg >= 0 ? Number(process.argv[arg + 1]) : config.cofl.days;
if (!Number.isFinite(days) || days <= 0) throw new Error('--days needs a number of days, e.g. --days 365');

const ctx = createContext(config);
const started = Date.now();
console.log(`Filling ${days} days of Bazaar prices from ${config.cofl.url} ...`);
const report = await backfillFromCofl(ctx.prices, { baseUrl: config.cofl.url, days, log: (m) => console.log(m) });
ctx.db.close();
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s, ${report.requests} request(s).`);
console.table(Object.entries(report.added).map(([item, added]) => ({ item, added })));
if (report.failed.length > 0) console.log(`Failed: ${report.failed.join(', ')}`);
