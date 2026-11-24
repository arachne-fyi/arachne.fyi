import { loadConfig } from '../config.ts';
import { createContext } from '../context.ts';
import { rebuildIndex } from './rebuild.ts';

// Usage: npm run rebuild-index   (stop the server first; both would write index.db)
const ctx = createContext(loadConfig());
const started = Date.now();
const report = await rebuildIndex(ctx);
ctx.db.close();
console.log(`Rebuilt index in ${Date.now() - started} ms`);
console.table(report);
