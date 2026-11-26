import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/**
 * Two SQLite files, on purpose:
 *
 *   index.db  everything derived from the NDJSON files (events, fights, uptime, prices).
 *             Safe to delete; `npm run rebuild-index` recreates it.
 *   state.db  things that exist nowhere else: users, sessions, tokens, account settings.
 *             Back this one up.
 *
 * state.db is ATTACHed to the same connection as `state`, so queries can join across both.
 *
 * Uses Node's built-in `node:sqlite`, so there is no native module to compile on
 * Windows or a Raspberry Pi.
 */

const INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  account     TEXT NOT NULL,
  ts          INTEGER NOT NULL,   -- event time, epoch ms UTC, corrected for client clock skew
  kind        TEXT NOT NULL,
  fight       TEXT,
  item        TEXT,
  count       REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0,  -- COINS only
  p_instant   REAL NOT NULL DEFAULT 0,  -- unit value at ts: Bazaar instant sell
  p_offer     REAL NOT NULL DEFAULT 0,  -- unit value at ts: Bazaar sell offer
  p_npc       REAL NOT NULL DEFAULT 0,  -- unit value: NPC / George
  pe_instant  REAL,                     -- like p_instant, but armour valued as the essence it salvages into
  pe_offer    REAL,                     -- like p_offer, same rule
  source      TEXT,
  received_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS events_account_ts ON events(account, ts);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
-- One fight's events (recent kills, drop rates), and the loot of one item in time order (dry
-- streaks, the collection book). Without these, those read every event ever stored.
CREATE INDEX IF NOT EXISTS events_account_fight ON events(account, fight);
CREATE INDEX IF NOT EXISTS events_loot_item ON events(item, account, ts) WHERE kind = 'LOOT';

CREATE TABLE IF NOT EXISTS fights (
  account      TEXT NOT NULL,
  fight        TEXT NOT NULL,
  spawn_ts     INTEGER,
  death_ts     INTEGER,
  damage       INTEGER,
  damage_ts    INTEGER,
  interrupt_ts INTEGER,
  tier         TEXT NOT NULL DEFAULT 'UNKNOWN',
  confirmed    INTEGER NOT NULL DEFAULT 0,
  anchor_ts    INTEGER NOT NULL,   -- COALESCE(spawn_ts, death_ts, interrupt_ts), kept for sorting
  PRIMARY KEY (account, fight)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fights_account_anchor ON fights(account, anchor_ts);
CREATE INDEX IF NOT EXISTS fights_account_death ON fights(account, death_ts);
-- Kill times and kill days read straight from the index (the kill rule needs damage and damage_ts).
CREATE INDEX IF NOT EXISTS fights_account_kill ON fights(account, death_ts, damage, damage_ts);

CREATE TABLE IF NOT EXISTS uptime (
  account TEXT NOT NULL,
  start   INTEGER NOT NULL,
  end     INTEGER NOT NULL,
  PRIMARY KEY (account, start)
) WITHOUT ROWID;

-- Events added up per account, per UTC hour, per kind and item. Totals read these few
-- hundred rows instead of every event. Kept in step by Indexer.index; values are stored in
-- all three price modes so an account can switch mode without recomputing.
CREATE TABLE IF NOT EXISTS hourly (
  account   TEXT NOT NULL,
  hour      INTEGER NOT NULL,   -- start of the hour, epoch ms
  kind      TEXT NOT NULL,      -- LOOT, PLACE or COINS
  item      TEXT NOT NULL,      -- '' for COINS
  count     REAL NOT NULL,
  v_instant REAL NOT NULL,
  v_offer   REAL NOT NULL,
  v_npc     REAL NOT NULL,
  ve_instant REAL,              -- totals with armour as essence (see events.pe_*)
  ve_offer   REAL,
  amount    REAL NOT NULL,
  PRIMARY KEY (account, hour, kind, item)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS prices (
  item    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  instant REAL,
  offer   REAL,
  PRIMARY KEY (item, ts)
) WITHOUT ROWID;
`;

const STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS state.users (
  id            INTEGER PRIMARY KEY,
  discord_id    TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS state.sessions (
  hash       TEXT PRIMARY KEY,     -- sha256 of the cookie value; the cookie itself is never stored
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state.tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE, -- sha256 of the token; shown to the user once, then gone
  prefix       TEXT NOT NULL,        -- first characters, so tokens can be told apart in the UI
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE TABLE IF NOT EXISTS state.accounts (
  uuid        TEXT PRIMARY KEY,      -- Minecraft UUID, lowercase, no dashes
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  price_mode  TEXT NOT NULL DEFAULT 'INSTANT_SELL' CHECK (price_mode IN ('INSTANT_SELL', 'SELL_OFFER', 'NPC')),
  ironman     INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  mod_version TEXT,
  state_json  TEXT
);
-- Small key/value settings an admin edits on the site (the announcement banner, ...).
CREATE TABLE IF NOT EXISTS state.settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- People who logged in with Discord but are not on the allowlist. Discord confirmed who
-- they are, so an admin can let them in with one click.
CREATE TABLE IF NOT EXISTS state.access_requests (
  discord_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  avatar     TEXT,
  created_at INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  dismissed  INTEGER NOT NULL DEFAULT 0
);
-- Reactions on drops (one of each kind per person per drop) and comments on fights.
CREATE TABLE IF NOT EXISTS state.reactions (
  event_id TEXT NOT NULL,
  user_id  INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id, kind)
);
CREATE TABLE IF NOT EXISTS state.comments (
  id       INTEGER PRIMARY KEY,
  target   TEXT NOT NULL,          -- an event id (a drop) or "account:fight"
  user_id  INTEGER NOT NULL,
  text     TEXT NOT NULL,
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS state.comments_target ON comments(target);
-- Friendly competitions: most kills or profit between two times.
CREATE TABLE IF NOT EXISTS state.challenges (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  metric     TEXT NOT NULL CHECK (metric IN ('kills', 'profit', 'crystals')),
  start_ts   INTEGER NOT NULL,
  end_ts     INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- Per-person settings that the server needs (notification webhook, thresholds, ...).
CREATE TABLE IF NOT EXISTS state.user_settings (
  user_id INTEGER PRIMARY KEY,
  json    TEXT NOT NULL
);
-- Things already announced, so a restart never sends the same message twice.
CREATE TABLE IF NOT EXISTS state.sent (
  key TEXT PRIMARY KEY,
  ts  INTEGER NOT NULL
);
-- Every admin action, newest last.
CREATE TABLE IF NOT EXISTS state.audit (
  id      INTEGER PRIMARY KEY,
  ts      INTEGER NOT NULL,
  user_id INTEGER,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);
-- Per-person choices the server needs when it adds things up or shows a profile.
CREATE TABLE IF NOT EXISTS state.user_prefs (
  user_id INTEGER PRIMARY KEY,
  armour  TEXT NOT NULL DEFAULT 'ITEM' CHECK (armour IN ('ITEM', 'ESSENCE')),
  title   TEXT,                 -- chosen title id; NULL = the kill-rank title
  public  TEXT                  -- JSON: which public-profile fields are shown
);
-- Which version of the terms each person accepted, and when.
CREATE TABLE IF NOT EXISTS state.consent (
  user_id     INTEGER PRIMARY KEY,
  version     TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  age_ok      INTEGER NOT NULL DEFAULT 0
);
-- Free or Pro. No row means free. "until" NULL means no end date.
CREATE TABLE IF NOT EXISTS state.plans (
  user_id    INTEGER PRIMARY KEY,
  plan       TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  until      INTEGER,
  source     TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
-- Redeemable codes made by an admin: a reward, a short life and a use limit.
CREATE TABLE IF NOT EXISTS state.codes (
  code       TEXT PRIMARY KEY,
  plan       TEXT NOT NULL DEFAULT 'pro',
  days       INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS state.code_uses (
  code    TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
-- What a person lets others see. Missing row = visible.
CREATE TABLE IF NOT EXISTS state.privacy (
  user_id INTEGER PRIMARY KEY,
  visible INTEGER NOT NULL DEFAULT 1
);
-- Groups: up to 100 people, joined with a short code.
CREATE TABLE IF NOT EXISTS state.groups (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state.group_members (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'mod', 'member')),
  show_tag  INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS state.group_members_user ON group_members(user_id);
`;

export class Db {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(dataDir: string | ':memory:') {
    const memory = dataDir === ':memory:';
    if (!memory) mkdirSync(dataDir, { recursive: true });
    this.raw = new DatabaseSync(memory ? ':memory:' : join(dataDir, 'index.db'));
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    const statePath = memory ? ':memory:' : join(dataDir, 'state.db').replace(/'/g, "''");
    this.raw.exec(`ATTACH DATABASE '${statePath}' AS state;`);
    if (!memory) this.raw.exec('PRAGMA state.journal_mode = WAL;');
    this.raw.exec(INDEX_SCHEMA);
    this.addColumns();
    this.raw.exec(STATE_SCHEMA);
    this.fillHourly();
  }

  /** Columns added after a table first shipped. Filled in by Indexer.backfillEssence(). */
  private addColumns() {
    const has = (table: string, col: string) =>
      (this.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
    for (const [table, col] of [
      ['events', 'pe_instant'],
      ['events', 'pe_offer'],
      ['hourly', 've_instant'],
      ['hourly', 've_offer'],
    ] as const) {
      if (!has(table, col)) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col} REAL`);
    }
  }

  /** An index.db from before the hourly table existed: build it once from the events. */
  private fillHourly() {
    const empty = !this.raw.prepare('SELECT 1 FROM hourly LIMIT 1').get();
    const hasEvents = !!this.raw.prepare("SELECT 1 FROM events WHERE kind IN ('LOOT','PLACE','COINS') LIMIT 1").get();
    if (empty && hasEvents) {
      this.raw.exec(`INSERT INTO hourly (account, hour, kind, item, count, v_instant, v_offer, v_npc, amount)
        SELECT account, (ts / 3600000) * 3600000, kind, COALESCE(item, ''), SUM(count),
               SUM(count * p_instant), SUM(count * p_offer), SUM(count * p_npc), SUM(amount)
        FROM events WHERE kind IN ('LOOT','PLACE','COINS')
        GROUP BY account, (ts / 3600000) * 3600000, kind, COALESCE(item, '')`);
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).run(...params);
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  /** Run `fn` atomically. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  /** Empty everything that can be rebuilt from the NDJSON files. */
  clearIndex() {
    this.raw.exec('DELETE FROM events; DELETE FROM fights; DELETE FROM uptime; DELETE FROM prices; DELETE FROM hourly;');
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}
