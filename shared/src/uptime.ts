import {
  KILL_DAMAGE_THRESHOLD,
  KILL_DAMAGE_WINDOW_MS,
  UPTIME_GRACE_MS,
  UPTIME_MAX_OPEN_FIGHT_MS,
} from './rules.ts';

/** What the server knows about one fight, folded together from its SPAWN/DEATH/DAMAGE/INTERRUPT events. */
export interface FightFacts {
  spawnTs: number | null;
  deathTs: number | null;
  damage: number | null;
  damageTs: number | null;
  interruptTs: number | null;
}

export type FightOutcome =
  | 'COUNTED'
  | 'LOW_DAMAGE'
  | 'ZERO_DAMAGE'
  | 'MISSING_DAMAGE'
  | 'INTERRUPTED'
  | 'OPEN';

/** Same outcomes as v1.5.0's FightRecord.Outcome, derived instead of stored by the client. */
export function fightOutcome(f: FightFacts): FightOutcome {
  if (f.deathTs == null) return f.interruptTs != null ? 'INTERRUPTED' : 'OPEN';
  if (f.damage == null) return 'MISSING_DAMAGE';
  if (f.damageTs != null && f.damageTs - f.deathTs > KILL_DAMAGE_WINDOW_MS) return 'MISSING_DAMAGE';
  if (f.damage >= KILL_DAMAGE_THRESHOLD) return 'COUNTED';
  return f.damage === 0 ? 'ZERO_DAMAGE' : 'LOW_DAMAGE';
}

export function isKill(f: FightFacts): boolean {
  return fightOutcome(f) === 'COUNTED';
}

export interface Segment {
  start: number;
  end: number;
}

function anchor(f: FightFacts): number | null {
  return f.spawnTs ?? f.deathTs ?? f.interruptTs;
}

/** How long after a death we still wait for its damage line before calling it missing. */
const DAMAGE_PENDING_MS = 60_000;

/**
 * Uptime for one account.
 *
 * - A boss the client damaged (damage > 0) starts uptime at that boss's spawn.
 * - While the client keeps damaging each boss, uptime runs through the gaps between them.
 * - A boss the client did not damage stops uptime at that boss's spawn.
 * - No new boss within 30s of the last death stops it at death + 30s.
 * - Leaving mid-fight stops it at that moment.
 *
 * Damage is only known at death, so the first fight of a run shows up once it ends.
 * `now` is used for fights that are still open.
 */
export function uptimeSegments(fights: readonly FightFacts[], now: number): Segment[] {
  const sorted = fights
    .filter((f) => anchor(f) != null)
    .sort((a, b) => anchor(a)! - anchor(b)!);
  const out: Segment[] = [];
  let cur: Segment | null = null;
  const close = (end: number) => {
    if (!cur) return;
    cur.end = Math.max(cur.start, end);
    if (cur.end > cur.start) out.push(cur);
    cur = null;
  };

  for (const f of sorted) {
    const start = anchor(f)!;
    if (cur && start > cur.end + UPTIME_GRACE_MS) close(cur.end + UPTIME_GRACE_MS);

    if (f.deathTs != null) {
      if (f.damage != null && f.damage > 0) {
        cur ??= { start, end: start };
        cur.end = Math.max(cur.end, f.deathTs);
      } else if (f.damage == null && now - f.deathTs < DAMAGE_PENDING_MS) {
        // The damage line normally arrives in the same batch; do not cut uptime in between.
        if (cur) cur.end = Math.max(cur.end, f.deathTs);
      } else if (cur) {
        close(Math.max(start, cur.end));
      }
    } else if (f.interruptTs != null) {
      if (cur) close(Math.max(cur.end, f.interruptTs));
    } else if (cur) {
      // Still fighting. Assume the client is taking part until the result says otherwise.
      cur.end = Math.max(cur.end, Math.min(now, start + UPTIME_MAX_OPEN_FIGHT_MS));
    }
  }
  if (cur) close(Math.min((cur as Segment).end + UPTIME_GRACE_MS, Math.max(now, (cur as Segment).end)));
  return out;
}

/** Milliseconds of `segments` that fall inside [from, to). */
export function clipMs(segments: readonly Segment[], from: number, to: number): number {
  let total = 0;
  for (const s of segments) {
    const a = Math.max(s.start, from);
    const b = Math.min(s.end, to);
    if (b > a) total += b - a;
  }
  return total;
}

/** Merge overlapping segments from several accounts into wall-clock coverage. */
export function union(lists: readonly (readonly Segment[])[]): Segment[] {
  const all = lists.flat().sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}
