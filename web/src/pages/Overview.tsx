import { useState, type ReactNode } from 'react';
import { coinsToMoney, KILL_DAMAGE_THRESHOLD, rarityColour, type Currency } from '@arachne/shared';
import { api, type AccountCard, type FeedEvent, type Me } from '../api.ts';
import { Empty, Head, Loading, Panel, SCOPE_OPTIONS, Switch, WINDOW_OPTIONS, type WindowKey } from '../components/Bits.tsx';
import { hasData, ProfitTotal } from '../components/Charts.tsx';
import {
  Announcement,
  DiscordShare,
  Delta,
  discordSummary,
  DryStreaks,
  GoalBar,
  isRareDrop,
  KillBars,
  Milestones,
  RareDropBanner,
} from '../components/Extras.tsx';
import { ago, clock, coins, duration, int, rankTitle } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';
import { useSettings } from '../settings.ts';

type Filter = 'all' | 'drops' | 'rare' | 'kills';
const FILTERS = [
  ['all', 'All'],
  ['drops', 'Drops'],
  ['rare', 'Rare'],
  ['kills', 'Kills'],
] as const;
const WINDOW_WORDS: Record<WindowKey, string> = { today: 'today', week: 'this week', all: 'all time' };

/** Lines the chat box shows. It never scrolls; older lines live on the Fights and Drops pages. */
const CHAT_LINES = 14;

/**
 * The home page, top to bottom: one strip with the headline numbers, a card per Minecraft
 * account, then this session's profit next to a chat-style log of what just happened.
 */
export function Overview({ me, goPairing }: { me: NonNullable<Me['user']>; goPairing: () => void }) {
  const [window, setWindow] = useState<WindowKey>('today');
  const [scope, setScope] = useState<'group' | 'user'>('group');
  const [filter, setFilter] = useState<Filter>('all');
  const [who, setWho] = useState<string>('');
  const [s, set] = useSettings();
  const currency = s.currency;
  const pickCurrency = (c: Currency) => set({ currency: c });
  const now = useNow();
  const overview = useLive(() => api.overview(scope), [scope]);
  const session = useLive(() => api.series('session'), []);
  const feed = useLive(() => api.events(80), []);

  if (!overview.data) {
    return (
      <main>
        <Loading error={overview.error} />
      </main>
    );
  }
  const { accounts } = overview.data;
  if (accounts.length === 0) {
    return (
      <main>
        <Announcement />
        <Checklist goPairing={goPairing} />
      </main>
    );
  }

  const shown = scope === 'user' ? accounts.filter((a) => a.userId === me.id) : accounts;
  const totals = overview.data.totals[scope];
  const t = totals[window];
  const ins = overview.data.insights;
  const farmingNow = accounts.filter((a) => a.up);
  const lines =
    feed.data?.events
      .filter(worthShowing)
      .filter((e) => !who || e.account === who)
      .filter((e) =>
        filter === 'drops' ? e.kind === 'LOOT' || e.kind === 'COINS' : filter === 'rare' ? isRareDrop(e) : filter === 'kills' ? e.kind === 'DAMAGE' : true,
      )
      .slice(0, CHAT_LINES) ?? [];
  const weekRate = totals.week.profitPerWallHour;

  return (
    <main>
      <Announcement />
      <RareDropBanner events={feed.data?.events} />
      <Milestones allTime={totals.all.profit} />
      {farmingNow.length > 0 && (
        <div className="farming-now">
          <span className="dot up" />
          Farming now: {farmingNow.map((a) => a.name).join(', ')}
        </div>
      )}
      <section className="panel strip">
        <div className="controls">
          <Switch label="Whose numbers" value={scope} onChange={setScope} options={SCOPE_OPTIONS} />
          <Switch label="Time" value={window} onChange={setWindow} options={WINDOW_OPTIONS} />
        </div>
        <div>
          <div className={`profit ${t.profit < 0 ? 'loss' : 'gain'}`}>{coins(t.profit)}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            profit, {coins(t.lootValue + t.coins)} in and {coins(t.costs)} spent
          </div>
          {overview.data.cookieCoins != null && (
            <RealMoney profit={t.profit} cookieCoins={overview.data.cookieCoins} currency={currency} onCurrency={pickCurrency} />
          )}
          {window === 'today' && (
            <div className="row compare">
              <span className="muted">vs yesterday</span>
              <Delta now={t.profit} before={ins.yesterday.profit} label="Yesterday's profit" />
              <Delta now={t.kills} before={ins.yesterday.kills} label="Yesterday's kills" money={false} />
            </div>
          )}
          {window === 'today' && <GoalBar profit={totals.today.profit} />}
        </div>
        <div className="stats">
          <Stat
            value={t.wallUptimeMs > 0 ? coins(t.profitPerWallHour) : '-'}
            label={
              window === 'today' && t.wallUptimeMs > 0 && weekRate > 0
                ? `per hour ${t.profitPerWallHour >= weekRate ? '▲' : '▼'}`
                : 'per hour'
            }
            tip={`All accounts together, per real hour. One account on its own averages ${coins(t.profitPerClientHour)} an hour.${
              weekRate > 0 ? ` Your 7-day average is ${coins(weekRate)} an hour.` : ''
            }`}
          />
          <Stat value={int(t.kills)} label="kills" tip={`${int(t.crystals)} crystals placed, ${int(t.fights)} bosses seen.`} />
          <Stat
            value={duration(t.uptimeMs)}
            label="farming"
            tip={`Every account's time added up. Real time with at least one account farming: ${duration(t.wallUptimeMs)}.`}
          />
          {ins.downtime.averageMs != null && (
            <Stat
              value={duration(ins.downtime.averageMs)}
              label="between bosses"
              tip="Today's average wait from one boss dying to the next one spawning. Breaks over 10 minutes are left out."
            />
          )}
        </div>
      </section>

      <TeamGoal />

      <div className="lifetime muted">
        All time: <b>{coins(totals.all.profit)}</b> profit from <b>{int(totals.all.kills)}</b> kills over <b>{int(ins.daysFarmed)}</b>{' '}
        {ins.daysFarmed === 1 ? 'day' : 'days'}.
        <DiscordShare window={window} text={() => discordSummary(WINDOW_WORDS[window], t, scope === 'user' ? me.name : 'Everyone')} />
      </div>

      <div className="players">
        {shown.map((a) => (
          <PlayerCard key={a.uuid} a={a} window={window} now={now} />
        ))}
      </div>

      <div className="grid-3-2">
        <Panel title="This session">
          {!session.data ? (
            <Loading error={session.error} />
          ) : session.data.empty || !hasData(session.data, 'profit') ? (
            <Empty>No session yet.</Empty>
          ) : (
            <ProfitTotal series={session.data} tall />
          )}
          <KillBars kills={ins.recentKills} />
        </Panel>
        <Panel
          title="Chat"
          side={
            <div className="row">
              <Switch label="Show" value={filter} onChange={setFilter} options={FILTERS} />
              {shown.length > 1 && (
                <select aria-label="Account" value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">All accounts</option>
                  {shown.map((a) => (
                    <option key={a.uuid} value={a.uuid}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          }
        >
          {!feed.data ? (
            <Loading error={feed.error} />
          ) : lines.length === 0 ? (
            <Empty>{filter === 'all' && !who ? 'Nothing yet.' : 'Nothing matches.'}</Empty>
          ) : (
            <ul className="chat">
              {lines.map((e) => (
                <ChatLine key={e.id} e={e} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Dry streaks" side={<span className="muted">kills since each rare drop</span>}>
        <DryStreaks dry={ins.dry} />
      </Panel>
    </main>
  );
}

/** The group's weekly profit goal, set by an admin. Hidden when there is none. */
function TeamGoal() {
  const g = useLive(api.teamGoal, [], 60_000);
  if (!g.data || g.data.goal <= 0) return null;
  const pct = Math.max(0, Math.min(1, g.data.profit / g.data.goal));
  return (
    <div className="goal team-goal" data-tip="Everyone's profit since Monday 00:00 UTC.">
      <div className="goal-label">
        <span>Team goal this week</span>
        <span>
          {coins(Math.max(0, g.data.profit))} / {coins(g.data.goal)}
          {pct >= 1 ? ' done!' : ''}
        </span>
      </div>
      <div className="goal-track">
        <div className={`goal-fill ${pct >= 1 ? 'done' : ''}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

/** First visit, nothing tracked yet: what to do, in order, with what is already done ticked. */
function Checklist({ goPairing }: { goPairing: () => void }) {
  const tokens = useLive(api.tokens, []);
  const paired = (tokens.data?.tokens.filter((t) => !t.revokedAt).length ?? 0) > 0;
  const used = tokens.data?.tokens.some((t) => t.lastUsedAt) ?? false;
  const steps: [boolean, string, ReactNode][] = [
    [used || paired, 'Install the mod', <a href="/download">Download it</a>],
    [paired, 'Pair it with your account', <button type="button" className="primary" onClick={goPairing}>Pair the mod</button>],
    [used, 'Kill Arachne', <span className="muted">Go to Arachne's Sanctuary and fight. Numbers show up here by themselves.</span>],
  ];
  return (
    <div className="panel card checklist" style={{ margin: '40px auto' }}>
      <h1>Get started</h1>
      <ol>
        {steps.map(([done, title, action]) => (
          <li key={title} className={done ? 'done' : undefined}>
            <span className="tick" aria-hidden="true">{done ? '✔' : ''}</span>
            <div>
              <b>{title}</b>
              {!done && <div>{action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ value, label, tip }: { value: string; label: string; tip: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="stat"
      data-tip={copied ? 'Copied' : tip}
      tabIndex={0}
      onDoubleClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function PlayerCard({ a, window, now }: { a: AccountCard; window: WindowKey; now: number }) {
  const t = a.totals[window];
  const fighting = a.online && a.state?.fighting;
  const status = fighting ? 'Fighting' : a.up ? 'Farming' : a.online ? 'Online' : `Seen ${ago(a.lastSeen, now)}`;
  return (
    <div className={`panel player ${a.up ? 'farming' : ''}`}>
      <div className="top">
        <Head uuid={a.uuid} />
        <div style={{ minWidth: 0 }}>
          <div className="name">{a.name}</div>
          <div className="rank" data-tip={rankNote(a.totals.all.kills)}>
            {rankTitle(a.totals.all.kills).title}
          </div>
          <div className="muted">
            <span className={a.up ? 'dot up' : a.online ? 'dot on' : 'dot'} />
            {status}
          </div>
        </div>
      </div>
      <div className="numbers">
        <div>
          <b className={t.profit < 0 ? 'loss' : 'gain'}>{coins(t.profit)}</b>
          <span>profit</span>
        </div>
        <div>
          <b>{int(t.kills)}</b>
          <span>kills</span>
        </div>
        <div>
          <b>{t.uptimeMs > 0 ? coins(t.profitPerClientHour) : '-'}</b>
          <span>per hour</span>
        </div>
      </div>
    </div>
  );
}

/** Spawn and death lines are noise next to the kill line that follows them. */
const worthShowing = (e: FeedEvent) => e.kind !== 'SPAWN' && e.kind !== 'DEATH' && !(e.kind === 'LOOT' && e.value <= 0);

/** One line in the style of Minecraft chat: drops in their rarity colour. */
function ChatLine({ e }: { e: FeedEvent }) {
  let body;
  let value: string | null = null;
  let tone = '';
  switch (e.kind) {
    case 'LOOT':
      body = (
        <>
          {int(e.count)}x <span style={{ color: rarityColour(e.item ?? '') }}>{e.itemName}</span>
        </>
      );
      value = `+${coins(e.value)}`;
      tone = 'gain';
      break;
    case 'COINS':
      body = <span style={{ color: '#ffd27a' }}>Scavenger coins</span>;
      value = `+${coins(e.value)}`;
      tone = 'gain';
      break;
    case 'PLACE':
      body = <span className="muted">placed {e.itemName}</span>;
      value = e.value > 0 ? `-${coins(e.value)}` : null;
      tone = 'loss';
      break;
    case 'DAMAGE':
      body =
        (e.damage ?? 0) >= KILL_DAMAGE_THRESHOLD ? (
          <span style={{ color: '#ff7a3d' }}>killed Arachne</span>
        ) : (
          <span className="muted">boss died, not enough damage</span>
        );
      break;
    case 'INTERRUPT':
      body = <span className="muted">left mid-fight</span>;
      break;
    default:
      body = e.kind;
  }
  return (
    <li>
      <time dateTime={new Date(e.ts).toISOString()}>{clock(e.ts).slice(0, 5)}</time>
      <span className="line">
        {e.accountName}: {body}
      </span>
      <span className={tone}>{value}</span>
    </li>
  );
}

function rankNote(kills: number): string {
  const { next } = rankTitle(kills);
  return next ? `${int(kills)} kills. Next title at ${int(next)}.` : `${int(kills)} kills. Top title.`;
}

/**
 * The profit in real money, if the coins had been bought legitimately: gems from the
 * Hypixel Store turned into Booster Cookies and sold on the Bazaar. Just for fun.
 */
function RealMoney({
  profit,
  cookieCoins,
  currency,
  onCurrency,
}: {
  profit: number;
  cookieCoins: number;
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) {
  const money = coinsToMoney(profit, cookieCoins, currency);
  const symbol = currency === 'GBP' ? '£' : '$';
  const text = `${money < 0 ? '-' : ''}${symbol}${Math.abs(money).toFixed(2)}`;
  return (
    <div className="real-money">
      <span
        className="value"
        data-tip={`What these coins would cost bought the official way: gems from the Hypixel Store, spent on Booster Cookies (325 gems each), sold on the Bazaar at ${coins(cookieCoins)} each. Not a real price.`}
      >
        {text}
      </span>
      <span className="muted">in real money</span>
      <Switch
        label="Currency"
        value={currency}
        onChange={onCurrency}
        options={[
          ['GBP', '£'],
          ['USD', '$'],
        ]}
      />
    </div>
  );
}
