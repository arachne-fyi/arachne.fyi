import { useState } from 'react';
import { rarityColour } from '@arachne/shared';
import { api, type Me } from '../api.ts';
import { Loading, SCOPE_OPTIONS, Switch } from '../components/Bits.tsx';
import { isRareDrop } from '../components/Extras.tsx';
import { ago, coins, duration, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

/** Today on one phone screen: the numbers you check mid-farm, nothing else. */
export function Glance({ me }: { me: NonNullable<Me['user']> }) {
  const [scope, setScope] = useState<'group' | 'user'>('user');
  const o = useLive(() => api.overview(scope), [scope]);
  const feed = useLive(() => api.events(200), []);
  const now = useNow(5_000);
  if (!o.data) return <main><Loading error={o.error} /></main>;
  const t = o.data.totals[scope].today;
  const up = o.data.accounts.filter((a) => a.up && (scope === 'group' || a.userId === me.id));
  const rare = feed.data?.events.find(isRareDrop);
  return (
    <main className="glance">
      <Switch label="Whose" value={scope} onChange={setScope} options={SCOPE_OPTIONS} />
      <div className="panel big">
        <span className="muted">Profit today</span>
        <b className={t.profit < 0 ? 'loss' : 'gain'}>{coins(t.profit)}</b>
      </div>
      <div className="glance-grid">
        <div className="panel big">
          <span className="muted">Per hour</span>
          <b>{t.wallUptimeMs > 0 ? coins(t.profitPerWallHour) : '-'}</b>
        </div>
        <div className="panel big">
          <span className="muted">Kills</span>
          <b>{int(t.kills)}</b>
        </div>
        <div className="panel big">
          <span className="muted">Farming</span>
          <b>{duration(t.wallUptimeMs)}</b>
        </div>
        <div className="panel big">
          <span className="muted">Crystals</span>
          <b>{int(t.crystals)}</b>
        </div>
      </div>
      <div className="panel">
        {up.length > 0 ? (
          <span>
            <span className="dot up" /> Farming now: {up.map((a) => a.name).join(', ')}
          </span>
        ) : (
          <span className="muted">Nobody farming right now.</span>
        )}
      </div>
      {rare && (
        <div className="panel">
          <span className="muted">Last rare drop: </span>
          {rare.accountName} got <span style={{ color: rarityColour(rare.item ?? '') }}>{rare.itemName}</span>, {ago(rare.ts, now)}
        </div>
      )}
    </main>
  );
}
