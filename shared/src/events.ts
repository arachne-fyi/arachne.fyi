import { z } from 'zod';
import { MAX_BATCH_EVENTS } from './rules.ts';

/**
 * The wire contract between the mod and the server.
 *
 * Clients send raw observations only: no prices, no kill counts, no uptime. The server
 * derives all of that (see rules.ts), so the meaning of the data can change without
 * touching old events.
 */
export const SCHEMA_VERSION = 1;

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'id must be 8-64 url-safe characters');
const fightId = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
const itemId = z.string().regex(/^[A-Z0-9_;:-]{1,64}$/);
const ts = z.number().int().min(1_500_000_000_000).max(9_999_999_999_999);

/**
 * Where the client was connected when it saw the event, as raw text. Stamped when the event is
 * recorded, so it stays right after a week in the offline queue. The server, not the mod,
 * decides what counts as the Alpha network (isAlphaOrigin in rules.ts).
 */
export const Origin = z.object({
  host: z.string().max(255).nullable(),
  brand: z.string().max(200).nullable(),
  motd: z.string().max(300).nullable(),
});
export type Origin = z.infer<typeof Origin>;

const base = {
  /** Client-generated, unique per event. The server dedupes on it, so retries are safe. */
  id,
  /** Client clock, epoch milliseconds UTC. */
  ts,
  /** Missing on events from mods older than 2.0.0-alpha.2. */
  origin: Origin.optional(),
};

export const SummonTier = z.enum(['CRYSTAL', 'CALLING', 'UNKNOWN']);
export type SummonTier = z.infer<typeof SummonTier>;

/** A boss appeared. `confirmed` is false when the spawn line was missed and the fight was recovered from later boss activity. */
export const SpawnEvent = z.object({
  ...base,
  kind: z.literal('SPAWN'),
  fight: fightId,
  tier: SummonTier,
  confirmed: z.boolean(),
});

/** "ARACHNE DOWN!" */
export const DeathEvent = z.object({ ...base, kind: z.literal('DEATH'), fight: fightId });

/** The "Your Damage: N" line that follows a death. */
export const DamageEvent = z.object({
  ...base,
  kind: z.literal('DAMAGE'),
  fight: fightId,
  damage: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/** The client stopped watching a live fight (left the area, disconnected, new ritual replaced it). */
export const InterruptEvent = z.object({
  ...base,
  kind: z.literal('INTERRUPT'),
  fight: fightId,
  reason: z.enum(['LEFT_AREA', 'DISCONNECT', 'NEW_RITUAL', 'OTHER']),
});

/** This account placed a summon item (a crystal, or one of four calling fragments). */
export const PlaceEvent = z.object({
  ...base,
  kind: z.literal('PLACE'),
  item: z.enum(['ARACHNE_CRYSTAL', 'ARACHNE_KEEPER_FRAGMENT']),
  count: z.number().int().min(1).max(64),
  fight: fightId.optional(),
});

export const LootEvent = z.object({
  ...base,
  kind: z.literal('LOOT'),
  item: itemId,
  count: z.number().int().min(1).max(1_000_000_000),
  source: z.enum(['armor_stand', 'pickup', 'pet_claim', 'manual']),
  fight: fightId.optional(),
});

/** Coins gained directly (Scavenger). */
export const CoinsEvent = z.object({
  ...base,
  kind: z.literal('COINS'),
  amount: z.number().min(0).max(1e12),
  source: z.enum(['scavenger', 'manual']),
  fight: fightId.optional(),
});

export const Event = z.discriminatedUnion('kind', [
  SpawnEvent,
  DeathEvent,
  DamageEvent,
  InterruptEvent,
  PlaceEvent,
  LootEvent,
  CoinsEvent,
]);
export type Event = z.infer<typeof Event>;
export type EventKind = Event['kind'];
export const EVENT_KINDS = ['SPAWN', 'DEATH', 'DAMAGE', 'INTERRUPT', 'PLACE', 'LOOT', 'COINS'] as const;

const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/)
  .transform((v) => v.replace(/-/g, '').toLowerCase());

/** POST /api/v1/batch. Events are validated one by one so a bad event never blocks the rest. */
export const BatchRequest = z.object({
  schema: z.literal(SCHEMA_VERSION),
  account: z.object({
    /** Minecraft account UUID, with or without dashes. */
    uuid,
    name: z.string().regex(/^[A-Za-z0-9_]{1,16}$/),
  }),
  mod: z.object({ version: z.string().max(32), minecraft: z.string().max(32) }),
  /** Client clock when the request was built. The server uses it to correct clock skew. */
  sentAt: ts,
  /** What the client is doing right now; shown on the dashboard, never stored as an event. */
  state: z
    .object({
      inArea: z.boolean(),
      fighting: z.boolean(),
      queued: z.number().int().min(0),
    })
    .optional(),
  events: z.array(z.unknown()).max(MAX_BATCH_EVENTS),
});
export type BatchRequest = z.infer<typeof BatchRequest>;

/**
 * POST /api/v1/live: one small packet the moment a boss spawns or dies, so the website's fight
 * timer starts and stops on time instead of waiting up to 30s for the next batch. Best effort:
 * the same SPAWN/DEATH still goes in a batch, which stays the stored record.
 *
 * Several accounts fighting the same boss each send one. `key` is how the server tells it is
 * the same boss: a hash of the lobby (server id from the sidebar) and the summon tier, so two
 * reports with the same key a few seconds apart are one boss. The server then takes the median
 * of their (clock-skew corrected) times as the boss's spawn and death.
 */
export const LiveRequest = z.object({
  schema: z.literal(SCHEMA_VERSION),
  account: z.object({ uuid, name: z.string().regex(/^[A-Za-z0-9_]{1,16}$/) }),
  mod: z.object({ version: z.string().max(32), minecraft: z.string().max(32) }),
  sentAt: ts,
  kind: z.enum(['SPAWN', 'DEATH']),
  /** When it happened on the client: epoch ms, UTC. */
  ts,
  /** This account's fight id, the same as on its SPAWN/DEATH events. */
  fight: fightId,
  tier: SummonTier.optional(),
  /** 16 hex characters: sha256("<lobby>|<tier>"). Missing when the lobby couldn't be read. */
  key: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});
export type LiveRequest = z.infer<typeof LiveRequest>;

/** One scope's numbers over one time window. */
export const Totals = z.object({
  kills: z.number(),
  fights: z.number(),
  crystals: z.number(),
  callings: z.number(),
  lootValue: z.number(),
  coins: z.number(),
  costs: z.number(),
  profit: z.number(),
  /** Sum of every account's uptime: 3 clients for 1h is 3h. */
  uptimeMs: z.number(),
  /** Time during which at least one account was up. */
  wallUptimeMs: z.number(),
  /** profit / uptimeMs: the average one client earns per hour. */
  profitPerClientHour: z.number(),
  /** profit / wallUptimeMs: what the whole scope earns per real hour. */
  profitPerWallHour: z.number(),
});
export type Totals = z.infer<typeof Totals>;

export const WINDOWS = ['today', 'week', 'all'] as const;
export type Window = (typeof WINDOWS)[number];
export const WindowTotals = z.object({ today: Totals, week: Totals, all: Totals });
export type WindowTotals = z.infer<typeof WindowTotals>;
const Focus = z.object({ soulString: z.number(), essence: z.number() });
const WindowFocus = z.object({ today: Focus, week: Focus, all: Focus });

export const BatchReply = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ id: z.string().nullable(), reason: z.string() })),
  /** Events dropped on purpose (seen on the Alpha network). Settled: don't resend. */
  ignored: z.number().int().optional(),
  serverTime: z.number().int(),
  /** Ask the client to wait this long before its next batch. */
  nextPollMs: z.number().int(),
  totals: z.object({
    /** The user's group (their first, up to 5 people), or just the user when in none. */
    group: WindowTotals,
    /** Every account owned by the token's user. */
    user: WindowTotals,
    /** Only the account that sent this batch. */
    account: WindowTotals,
  }),
  /** Soul String and Spider Essence counts, same scopes and windows as `totals`. */
  focus: z
    .object({ group: WindowFocus, user: WindowFocus, account: WindowFocus })
    .optional(),
  /** Tag of the group behind `totals.group`, or null when the user is in no group. */
  groupTag: z.string().nullable().optional(),
  /** The group's accounts that sent a batch recently, for the HUD's "3 online" line. */
  online: z.number().int(),
});
export type BatchReply = z.infer<typeof BatchReply>;

export const EMPTY_TOTALS: Totals = {
  kills: 0,
  fights: 0,
  crystals: 0,
  callings: 0,
  lootValue: 0,
  coins: 0,
  costs: 0,
  profit: 0,
  uptimeMs: 0,
  wallUptimeMs: 0,
  profitPerClientHour: 0,
  profitPerWallHour: 0,
};
