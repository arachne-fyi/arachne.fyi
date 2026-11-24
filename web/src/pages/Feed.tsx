import { useState } from 'react';
import { rarityColour } from '@arachne/shared';
import { api, type Challenge, type FeedDrop, type Me, type ReactionKind } from '../api.ts';
import { Empty, Loading, Panel } from '../components/Bits.tsx';
import { parseCoins } from '../components/Extras.tsx';
import { ago, coins, dateTime, duration, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

const REACTIONS: [ReactionKind, string, string][] = [
  ['fire', '🔥', 'Fire'],
  ['clap', '👏', 'Well done'],
  ['cry', '😭', 'Jealous'],
  ['spider', '🕷️', 'Spider'],
];

/** Everyone's rare drops for the last 30 days, with reactions and comments, plus challenges. */
export function Feed({ me }: { me: NonNullable<Me['user']> }) {
  const feed = useLive(api.feed, []);
  const challenges = useLive(api.challenges, [], 60_000);
  const now = useNow(30_000);
  const [shown, setShown] = useState(20);

  return (
    <main>
      <div className="head">
        <h1>Feed</h1>
      </div>

      {feed.data?.dropOfTheWeek && (
        <section className="panel drop-of-week">
          <span className="muted">Drop of the week</span>
          <b style={{ color: rarityColour(feed.data.dropOfTheWeek.item) }}>
            {int(feed.data.dropOfTheWeek.count)}x {feed.data.dropOfTheWeek.name}
          </b>
          <span>
            {feed.data.dropOfTheWeek.account}, worth {coins(feed.data.dropOfTheWeek.value)}, {ago(feed.data.dropOfTheWeek.ts, now)}
          </span>
        </section>
      )}

      <Panel title="Challenges" side={<NewChallenge onDone={challenges.refresh} />}>
        {!challenges.data ? (
          <Loading error={challenges.error} />
        ) : challenges.data.challenges.length === 0 ? (
          <Empty>No challenges right now. Start one: most kills in a day, most profit this weekend…</Empty>
        ) : (
          <div className="challenges">
            {challenges.data.challenges.map((c) => (
              <ChallengeCard key={c.id} c={c} now={now} canDelete={c.createdBy === me.id || me.role === 'admin'} onChange={challenges.refresh} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Rare drops" side={<span className="muted">last 30 days</span>}>
        {!feed.data ? (
          <Loading error={feed.error} />
        ) : feed.data.drops.length === 0 ? (
          <Empty>No rare drops in the last 30 days. Someone's due.</Empty>
        ) : (
          <ul className="drop-feed">
            {feed.data.drops.slice(0, shown).map((d) => (
              <FeedItem key={d.id} d={d} me={me} now={now} onChange={feed.refresh} />
            ))}
          </ul>
        )}
        {feed.data && feed.data.drops.length > shown && (
          <button type="button" style={{ marginTop: 12 }} onClick={() => setShown(shown + 20)}>
            Show more ({feed.data.drops.length - shown} left)
          </button>
        )}
      </Panel>
    </main>
  );
}

function FeedItem({ d, me, now, onChange }: { d: FeedDrop; me: NonNullable<Me['user']>; now: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="feed-line">
        <span className="muted" data-tip={dateTime(d.ts)}>
          {ago(d.ts, now)}
        </span>
        <span>
          <b>{d.accountName}</b> got {int(d.count)}x <span style={{ color: rarityColour(d.item) }}>{d.name}</span>
        </span>
        <span className="gain">{coins(d.value)}</span>
      </div>
      <div className="feed-actions">
        {REACTIONS.map(([kind, icon, label]) => (
          <button
            key={kind}
            type="button"
            className="reaction"
            aria-pressed={d.mine.includes(kind)}
            aria-label={label}
            onClick={() => void api.react(d.id, kind).then(onChange)}
          >
            <span className="emoji">{icon}</span> {d.reactions[kind] || ''}
          </button>
        ))}
        <button type="button" className="reaction" aria-expanded={open} onClick={() => setOpen(!open)}>
          {d.comments > 0 ? `${d.comments} ${d.comments === 1 ? 'comment' : 'comments'}` : 'Comment'}
        </button>
      </div>
      {open && <Comments target={d.id} me={me} now={now} onChange={onChange} />}
    </li>
  );
}

function Comments({ target, me, now, onChange }: { target: string; me: NonNullable<Me['user']>; now: number; onChange: () => void }) {
  const list = useLive(() => api.comments(target), [target]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="comments">
      {list.data?.comments.map((c) => (
        <div key={c.id} className="comment">
          <b>{c.by}</b> <span>{c.text}</span> <span className="faint">{ago(c.ts, now)}</span>
          {(c.userId === me.id || me.role === 'admin') && (
            <button type="button" className="small" onClick={() => void api.deleteComment(c.id).then(() => (list.refresh(), onChange()))}>
              Delete
            </button>
          )}
        </div>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setBusy(true);
          void api
            .comment(target, text)
            .then(() => {
              setText('');
              list.refresh();
              onChange();
            })
            .finally(() => setBusy(false));
        }}
      >
        <input aria-label="Comment" maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something" style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" disabled={busy || !text.trim()} aria-busy={busy}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </form>
    </div>
  );
}

const METRIC_WORDS = { kills: 'Most kills', profit: 'Most profit', crystals: 'Most crystals' } as const;

function ChallengeCard({ c, now, canDelete, onChange }: { c: Challenge; now: number; canDelete: boolean; onChange: () => void }) {
  const state = now < c.start ? `Starts in ${duration(c.start - now)}` : now < c.end ? `Ends in ${duration(c.end - now)}` : `Ended ${ago(c.end, now)}`;
  const show = (v: number) => (c.metric === 'profit' ? coins(v) : int(v));
  return (
    <div className="panel challenge">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b>{c.title}</b>
        <span className="muted">{state}</span>
      </div>
      <div className="muted">
        {METRIC_WORDS[c.metric]}, started by {c.by}
      </div>
      {c.standings.length === 0 ? (
        <p className="empty">Nobody on the board yet.</p>
      ) : (
        <ol className="standings">
          {c.standings.slice(0, 5).map((s) => (
            <li key={s.name}>
              <span>{s.name}</span>
              <b>{show(s.value)}</b>
            </li>
          ))}
        </ol>
      )}
      {canDelete && (
        <button type="button" className="small" onClick={() => void api.deleteChallenge(c.id).then(onChange)}>
          Delete
        </button>
      )}
    </div>
  );
}

function NewChallenge({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<Challenge['metric']>('kills');
  const [hours, setHours] = useState('24');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Start a challenge
      </button>
    );
  }
  return (
    <form
      className="row new-challenge"
      onSubmit={(e) => {
        e.preventDefault();
        const h = Math.round(parseCoins(hours));
        api
          .createChallenge({ title: title || METRIC_WORDS[metric], metric, start: Date.now(), hours: h })
          .then(() => {
            setOpen(false);
            setTitle('');
            onDone();
          })
          .catch(() => setError('Hours must be between 1 and 744.'));
      }}
    >
      <input aria-label="Name" placeholder="Name" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
      <select aria-label="What counts" value={metric} onChange={(e) => setMetric(e.target.value as Challenge['metric'])}>
        <option value="kills">Most kills</option>
        <option value="profit">Most profit</option>
        <option value="crystals">Most crystals</option>
      </select>
      <label className="inline">
        for <input aria-label="Hours" size={4} value={hours} onChange={(e) => setHours(e.target.value)} /> hours
      </label>
      <button type="submit" className="primary">
        Start
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="loss">{error}</span>}
    </form>
  );
}
