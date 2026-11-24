import { api, type AccountCard, type Me } from '../api.ts';
import { Empty, Head, Loading, Panel, Toggle } from '../components/Bits.tsx';
import { ago, coins, duration, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

/** Your Minecraft accounts: what each has done, and how its drops are priced. */
export function Account({ me }: { me: NonNullable<Me['user']> }) {
  const overview = useLive(api.overview, []);
  const now = useNow(10_000);
  const mine = overview.data?.accounts.filter((a) => a.userId === me.id) ?? [];

  return (
    <main>
      <div className="head">
        <div className="row" style={{ alignItems: 'center' }}>
          {me.avatar ? (
            <img className="avatar" src={me.avatar} alt="" style={{ width: 48, height: 48 }} />
          ) : (
            <span className="avatar" style={{ width: 48, height: 48 }}>
              {me.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <h1>{me.name}</h1>
        </div>
      </div>

      {!overview.data ? (
        <Loading error={overview.error} />
      ) : mine.length === 0 ? (
        <Panel>
          <Empty>
            No Minecraft accounts yet. <a href="/pairing">Pair the mod</a> and play; they show up here by themselves.
          </Empty>
        </Panel>
      ) : (
        <div className="grid-2">
          {mine.map((a) => (
            <AccountPanel key={a.uuid} a={a} now={now} onChange={overview.refresh} />
          ))}
        </div>
      )}
    </main>
  );
}

function AccountPanel({ a, now, onChange }: { a: AccountCard; now: number; onChange: () => void }) {
  const all = a.totals.all;
  return (
    <section className="panel">
      <header>
        <span className="who">
          <Head uuid={a.uuid} />
          {a.name}
        </span>
        <span className="muted">
          <span className={a.up ? 'dot up' : a.online ? 'dot on' : 'dot'} />
          {a.up ? 'Farming' : a.online ? 'Online' : `Last seen ${ago(a.lastSeen, now)}`}
        </span>
      </header>
      <div className="row" style={{ gap: 24, marginBottom: 16 }}>
        <span>
          <b className="gain">{coins(all.profit)}</b> <span className="muted">profit</span>
        </span>
        <span>
          <b>{int(all.kills)}</b> <span className="muted">kills</span>
        </span>
        <span>
          <b>{duration(all.uptimeMs)}</b> <span className="muted">farming</span>
        </span>
      </div>
      <div className="row">
        <label>
          Price drops at
          <select
            value={a.priceMode}
            disabled={a.ironman}
            onChange={(e) => void api.patchAccount(a.uuid, { priceMode: e.target.value as AccountCard['priceMode'] }).then(onChange)}
          >
            <option value="INSTANT_SELL">Bazaar instant sell</option>
            <option value="SELL_OFFER">Bazaar sell offer</option>
            <option value="NPC">NPC price</option>
          </select>
        </label>
        <div className="toggle-field">
          <span>Ironman</span>
          <Toggle label="Ironman" on={a.ironman} onChange={(ironman) => void api.patchAccount(a.uuid, { ironman }).then(onChange)} />
        </div>
      </div>
      <p className="faint" style={{ marginTop: 10 }}>
        Mod {a.modVersion ?? 'unknown'}. Changing the price setting re-prices all past drops too.
      </p>
    </section>
  );
}
