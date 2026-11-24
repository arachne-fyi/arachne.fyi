import { useEffect, useRef, useState } from 'react';
import { rarityColour, type Totals } from '@arachne/shared';
import { api, type DryStreak, type FeedEvent } from '../api.ts';
import { platform } from '../platform-api.ts';
import { coins, dateTime, duration, fullCoins, int } from '../format.ts';
import { useLive } from '../hooks.ts';
import { remember, remembered, useSettings } from '../settings.ts';

/** Drops that get the banner, the sound and the spider, whatever they are worth. */
export const RARE_ITEMS = new Set(['DARK_QUEENS_SOUL_DROP', 'ARACHNE_FANG', 'TARANTULA_EPIC', 'TARANTULA_LEGENDARY']);
const BIG_DROP = 1_000_000;
export const isRareDrop = (e: FeedEvent) => e.kind === 'LOOT' && (RARE_ITEMS.has(e.item ?? '') || e.value >= BIG_DROP);

/** The admin's message, at the top of the Overview. */
export function Announcement() {
  const a = useLive(api.announcement, [], 120_000);
  const [hidden, setHidden] = useState(remembered('announcement-hidden'));
  const note = a.data?.announcement;
  if (!note || hidden === String(note.at)) return null;
  return (
    <div className="panel announcement" role="status">
      <span>{note.text}</span>
      <span className="muted">
        {note.by}, {dateTime(note.at)}
      </span>
      <button
        type="button"
        onClick={() => {
          remember('announcement-hidden', String(note.at));
          setHidden(String(note.at));
        }}
      >
        Hide
      </button>
    </div>
  );
}

/**
 * Watches the drop log. When a rare drop arrives that was not there on the last refresh,
 * it shows a banner for a few seconds, and (if turned on) a short sound and a spider.
 */
export function RareDropBanner({ events }: { events: FeedEvent[] | undefined }) {
  const [s] = useSettings();
  const seen = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<FeedEvent | null>(null);

  useEffect(() => {
    if (!events) return;
    const rare = events.filter(isRareDrop);
    if (seen.current === null) {
      // First load: everything already in the log is old news.
      seen.current = new Set(rare.map((e) => e.id));
      return;
    }
    const fresh = rare.find((e) => !seen.current!.has(e.id) && Date.now() - e.ts < 10 * 60_000);
    rare.forEach((e) => seen.current!.add(e.id));
    if (!fresh) return;
    setShown(fresh);
    if (s.sound) jingle();
  }, [events, s.sound]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 8_000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <>
      <div className="rare-banner" role="alert" onClick={() => setShown(null)}>
        <b>RARE DROP!</b> {shown.accountName} got {int(shown.count)}x{' '}
        <span style={{ color: rarityColour(shown.item ?? '') }}>{shown.itemName}</span> worth {coins(shown.value)}
      </div>
      {!s.calm && <div className="crawler" aria-hidden="true" />}
    </>
  );
}

/** Four rising square-wave notes, like a level-up. Made in the browser, no sound file. */
function jingle() {
  try {
    const ac = new AudioContext();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.06, ac.currentTime + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.09 + 0.18);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.09);
      o.stop(ac.currentTime + i * 0.09 + 0.2);
    });
    setTimeout(() => void ac.close(), 1_000);
  } catch {
    /* no audio: fine */
  }
}

/** Today's profit as a boss health bar filling towards your daily goal. */
export function GoalBar({ profit }: { profit: number }) {
  const [s, set] = useSettings();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (editing || s.dailyGoal <= 0) {
    if (!editing) {
      return (
        <button type="button" className="goal-set" onClick={() => setEditing(true)}>
          Set a daily goal
        </button>
      );
    }
    return (
      <form
        className="row goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          set({ dailyGoal: parseCoins(text) });
          setEditing(false);
        }}
      >
        <label>
          Daily profit goal
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 20m" />
        </label>
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }
  const pct = Math.max(0, Math.min(1, profit / s.dailyGoal));
  return (
    <div className="goal" data-tip="Click to change your goal. Resets at midnight UTC." onClick={() => setEditing(true)} role="button" tabIndex={0}>
      <div className="goal-label">
        <span>Daily goal</span>
        <span>
          {coins(Math.max(0, profit))} / {coins(s.dailyGoal)}
          {pct >= 1 ? ' done!' : ''}
        </span>
      </div>
      <div className="goal-track">
        <div className={`goal-fill ${pct >= 1 ? 'done' : ''}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

/** "20m", "1.5b", "250k" or plain digits. */
export function parseCoins(text: string): number {
  const m = /^\s*([\d.,]+)\s*([kmb]?)\s*$/i.exec(text);
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ''));
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]!.toLowerCase() as '' | 'k' | 'm' | 'b'];
  return Number.isFinite(n) ? Math.round(n * mult) : 0;
}

/** How many kills since each rare drop last showed up. */
export function DryStreaks({ dry }: { dry: DryStreak[] }) {
  return (
    <ul className="dry">
      {dry.map((d) => (
        <li key={d.item} data-tip={d.dropped > 0 ? `Dropped ${int(d.dropped)} times. Longest wait: ${int(d.longest)} kills.` : 'Not dropped yet.'}>
          <span style={{ color: rarityColour(d.item) }}>{d.name}</span>
          <b>{int(d.current)}</b>
          <span className="muted">{d.dropped > 0 ? 'kills since the last one' : 'kills, none yet'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Loot value of each recent kill, with the average as a line. */
export function KillBars({ kills }: { kills: { ts: number; value: number }[] }) {
  if (kills.length === 0) return null;
  const max = Math.max(...kills.map((k) => k.value), 1);
  const avg = kills.reduce((n, k) => n + k.value, 0) / kills.length;
  const w = 100 / kills.length;
  return (
    <div className="kill-bars" data-tip={`Last ${kills.length} kills. Average ${coins(avg)} of loot each.`}>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`Loot per kill, average ${coins(avg)}`}>
        {kills.map((k, i) => (
          <rect key={k.ts} x={i * w + w * 0.15} width={w * 0.7} y={30 - (k.value / max) * 28} height={(k.value / max) * 28} fill={k.value >= avg ? '#ffa62b' : '#9c8f7c'} />
        ))}
        <line x1="0" x2="100" y1={30 - (avg / max) * 28} y2={30 - (avg / max) * 28} stroke="#f5ecdb" strokeWidth="0.6" strokeDasharray="2 2" />
      </svg>
      <span className="muted">{coins(avg)} a kill</span>
    </div>
  );
}

/** Up or down compared with another number, as a small chip. */
export function Delta({ now, before, label, money = true }: { now: number; before: number; label: string; money?: boolean }) {
  if (before === 0 && now === 0) return null;
  const diff = now - before;
  const up = diff >= 0;
  return (
    <span className={`delta ${up ? 'gain' : 'loss'}`} data-tip={`${label}: ${money ? coins(before) : int(before)}`}>
      {up ? '▲' : '▼'} {money ? coins(Math.abs(diff)) : int(Math.abs(diff))}
    </span>
  );
}

const MILESTONES = [1e6, 1e7, 1e8, 1e9, 1e10];

/** Confetti the first time lifetime profit passes 1M, 10M, 100M... in this browser. */
export function Milestones({ allTime }: { allTime: number }) {
  const [s] = useSettings();
  const [hit, setHit] = useState<number | null>(null);
  useEffect(() => {
    const last = Number(remembered('milestone') ?? NaN);
    const reached = MILESTONES.filter((m) => allTime >= m).at(-1) ?? 0;
    if (Number.isNaN(last)) {
      // First visit: don't celebrate old milestones.
      remember('milestone', String(reached));
      return;
    }
    if (reached > last) {
      remember('milestone', String(reached));
      setHit(reached);
      const t = setTimeout(() => setHit(null), 6_000);
      return () => clearTimeout(t);
    }
  }, [allTime]);
  if (!hit) return null;
  return (
    <div className="milestone" role="status" onClick={() => setHit(null)}>
      {!s.calm && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.12}s` }} />
          ))}
        </div>
      )}
      <b>{coins(hit)} profit, all time!</b>
    </div>
  );
}

/** A plain-text summary that pastes nicely into Discord. */
export function discordSummary(label: string, t: Totals, name: string): string {
  return [
    `**${name}: Arachne ${label}**`,
    `Profit: ${coins(t.profit)} (${fullCoins(t.profit)} coins)`,
    `Kills: ${int(t.kills)}  Crystals: ${int(t.crystals)}`,
    `Farming: ${duration(t.uptimeMs)}${t.wallUptimeMs > 0 ? `  Per hour: ${coins(t.profitPerWallHour)}` : ''}`,
    '<https://arachne.fyi>',
  ].join('\n');
}

/**
 * "Post to Discord": the server sends a real embed through the webhook saved in Settings.
 * Without a webhook there is nowhere to post an embed, so it copies the plain text instead.
 */
export function DiscordShare({ window, text }: { window: 'today' | 'week' | 'all'; text: () => string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'posted' | 'copied' | 'fail'>('idle');
  const reset = () => setTimeout(() => setState('idle'), 2_500);
  const copy = () =>
    navigator.clipboard
      .writeText(text())
      .then(() => setState('copied'))
      .catch(() => setState('fail'))
      .finally(reset);
  return (
    <span className="row discord-share">
      <button
        type="button"
        disabled={state === 'busy'}
        aria-busy={state === 'busy'}
        onClick={() => {
          setState('busy');
          platform
            .postToDiscord(window)
            .then(() => setState('posted'))
            .catch((e: Error) => (e.message === 'no_webhook' ? copy() : setState('fail')))
            .finally(reset);
        }}
      >
        {state === 'posted' ? 'Posted' : state === 'copied' ? 'No webhook: copied text' : state === 'fail' ? "Couldn't post" : 'Post to Discord'}
      </button>
      <button type="button" className="small" onClick={copy} data-tip="Plain text, for anywhere">
        Copy text
      </button>
    </span>
  );
}

export function CopyButton({ text, label = 'Copy for Discord' }: { text: () => string; label?: string }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(text())
          .then(() => setDone('ok'))
          .catch(() => setDone('fail'))
          .finally(() => setTimeout(() => setDone(null), 2_000));
      }}
    >
      {done === 'ok' ? 'Copied' : done === 'fail' ? 'Could not copy' : label}
    </button>
  );
}
