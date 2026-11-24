import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Load .env from the repo root or the server folder, whichever exists. Real environment
// variables win, so Docker's `environment:` block always overrides the file.
// Data lives next to whichever .env was used (the repo root in development), so the server,
// the rebuild script and the mod's publishToServer task all agree on one ./data folder.
let baseDir = process.cwd();
for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(file)) {
    baseDir = dirname(file);
    try {
      process.loadEnvFile(file);
    } catch {
      /* unreadable .env: continue with the process environment */
    }
    break;
  }
}

const env = process.env;
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const flag = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';
const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Where the built dashboard lives; empty means "API only" (dev, where Vite serves the web app). */
  webDir: string;
  /** Public origin of the dashboard, e.g. https://app.arachne.fyi. Used for OAuth and cookies. */
  publicUrl: string;
  /** Hostname that should show the landing page instead of the dashboard, e.g. arachne.fyi. */
  landingHost: string;
  discord: { clientId: string; clientSecret: string };
  /** Discord user IDs that are always allowed in, as admins. This is how the first admin exists. */
  adminDiscordIds: string[];
  /** Local development only: enables POST /auth/dev-login, which skips Discord. */
  devAuth: boolean;
  sessionDays: number;
  bazaar: { enabled: boolean; pollMs: number; url: string };
  /** Discord channel webhook for rare-drop posts. Empty turns the feature off. */
  discordWebhookUrl: string;
  /** Drops worth at least this many coins are posted (the rare drops are always posted). */
  rareDropMinCoins: number;
  /** Where the nightly copy of state.db goes. Point it at a second drive if you have one. */
  backupDir: string;
  /**
   * A test server: allows wiping all data from the Admin page and with `npm run purge`.
   * Off unless ALPHA_MODE=1. Turning it on for an https address also needs
   * ALPHA_MODE_PUBLIC=1, so a real deployment can't get it by a stray line in .env.
   */
  alphaMode: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = int(env.PORT, 8787);
  const config: Config = {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(baseDir, env.DATA_DIR ?? './data'),
    webDir: env.WEB_DIR ? resolve(baseDir, env.WEB_DIR) : '',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    landingHost: (env.LANDING_HOST ?? '').toLowerCase(),
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? '',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    },
    adminDiscordIds: list(env.ADMIN_DISCORD_IDS),
    devAuth: flag(env.DEV_AUTH),
    sessionDays: int(env.SESSION_DAYS, 30),
    bazaar: {
      enabled: env.BAZAAR_ENABLED === undefined ? true : flag(env.BAZAAR_ENABLED),
      pollMs: int(env.BAZAAR_POLL_MS, 5 * 60_000),
      url: env.BAZAAR_URL ?? 'https://api.hypixel.net/v2/skyblock/bazaar',
    },
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL ?? '',
    rareDropMinCoins: int(env.RARE_DROP_MIN_COINS, 1_000_000),
    backupDir: resolve(baseDir, env.BACKUP_DIR ?? './data/backups'),
    alphaMode: flag(env.ALPHA_MODE),
    ...overrides,
  };
  if (config.devAuth && config.publicUrl.startsWith('https://')) {
    throw new Error('DEV_AUTH must not be enabled on a public HTTPS deployment.');
  }
  if (config.alphaMode && config.publicUrl.startsWith('https://') && !flag(env.ALPHA_MODE_PUBLIC)) {
    throw new Error('ALPHA_MODE on an https address also needs ALPHA_MODE_PUBLIC=1. Is this really a test server?');
  }
  return config;
}
