import { loadConfig } from './config.ts';
import { createContext } from './context.ts';
import { buildApp } from './app.ts';
import { backupState } from './extras.ts';
import { startBazaarPoller } from './prices.ts';
import { blockNetwork, isOffline, offlineConfig, offlineSummary, prepareOffline } from './offline.ts';

// OFFLINE=1 (start-offline.bat): a read-only local copy with no network. See offline.ts.
const offline = isOffline();
if (offline) blockNetwork();
const config = offline ? offlineConfig(loadConfig()) : loadConfig();
const ctx = createContext(config);
if (offline) prepareOffline(ctx);
const app = await buildApp(ctx);

if (config.bazaar.enabled) {
  startBazaarPoller(ctx.prices, {
    url: config.bazaar.url,
    pollMs: config.bazaar.pollMs,
    log: (msg) => app.log.warn(msg),
    onUpdate: () => {
      ctx.stats.invalidate();
      ctx.hub.publish('prices', { updatedAt: ctx.prices.updatedAt });
    },
  });
}

// Uptime segments that end "now" need nudging forward while a run is in progress.
setInterval(() => {
  try {
    ctx.indexer.refreshLiveUptime(Date.now());
    ctx.stats.invalidate();
  } catch (err) {
    app.log.error(err, 'uptime refresh failed');
  }
}, 10_000).unref();

// Personal Discord messages that are not tied to a batch: session recaps, weekly digest.
if (!offline) setInterval(() => {
  try {
    ctx.notifier.tick(Date.now());
  } catch (err) {
    app.log.error(err, 'notifications failed');
  }
}, 60_000).unref();

// Housekeeping once an hour: expired sessions, and gzip day files older than two days.
const housekeeping = () => {
  try {
    const now = Date.now();
    ctx.auth.pruneSessions(now);
    const zipped = ctx.events.compressOld(now) + ctx.priceLog.compressOld(now);
    if (zipped > 0) app.log.info(`compressed ${zipped} old day file(s)`);
    // One copy of state.db per day (the first housekeeping run after midnight UTC makes it).
    const copy = backupState(ctx, now);
    if (copy) app.log.info(`backed up state.db to ${copy}`);
  } catch (err) {
    app.log.error(err, 'housekeeping failed');
  }
};
if (!offline) {
  housekeeping();
  setInterval(housekeeping, 3_600_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    ctx.db.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Arachne.fyi server ready. data=${config.dataDir} public=${config.publicUrl}` +
    (config.devAuth ? ' DEV_AUTH=on' : '') +
    (config.discord.clientId ? '' : ' (Discord login not configured)'),
);
if (offline) app.log.info(offlineSummary());
