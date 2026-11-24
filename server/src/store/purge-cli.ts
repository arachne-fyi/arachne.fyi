import { loadConfig } from '../config.ts';
import { createContext } from '../context.ts';
import { purgeData } from '../purge.ts';

// Usage: npm run purge -- --yes [--everything]   (stop the server first)
// Refuses unless ALPHA_MODE=1 is set, in .env or the shell, so it can't wipe a real server by accident.
const config = loadConfig();
const args = process.argv.slice(2);
if (!config.alphaMode) {
  console.error('Refused: set ALPHA_MODE=1 (in .env) on a test server to allow purging.');
  process.exit(1);
}
if (!args.includes('--yes')) {
  console.error(`This deletes every event in ${config.dataDir}${args.includes('--everything') ? ', plus accounts, groups and comments' : ''}.`);
  console.error('Run again with --yes to do it.');
  process.exit(1);
}
const ctx = createContext(config);
const r = purgeData(ctx, args.includes('--everything'));
ctx.db.close();
console.log(`Purged: ${r.files} day files removed, index emptied${args.includes('--everything') ? ', accounts and groups removed' : ''}.`);
