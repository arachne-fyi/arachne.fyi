import { useState } from 'react';
import { exportUrl, api } from '../api.ts';
import { Empty, Loading, Panel, Switch, WINDOW_OPTIONS, type WindowKey } from '../components/Bits.tsx';
import { DropRatesPanel, Market, WhatIf } from '../components/More.tsx';
import { fakeDropRates, fakeWhatIf, ProLock, useIsPro } from '../components/Locked.tsx';
import { ago, coins, int } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

export function Loot() {
  const [window, setWindow] = useState<WindowKey>('week');
  const [scope, setScope] = useState<'group' | 'me'>('group');
  const loot = useLive(() => api.loot(window, scope), [window, scope]);
  const prices = useLive(api.prices, [], 60_000);
  const now = useNow(10_000);
  const pro = useIsPro();
  const rates = useLive(() => (pro ? api.dropRates(scope) : Promise.resolve(null)), [scope, pro], 60_000);
  const movers = useLive(api.movers, [], 120_000);
  const whatIf = useLive(() => (pro ? api.whatIf(scope, window === 'today' ? 1 : window === 'week' ? 7 : 0) : Promise.resolve(null)), [scope, window, pro], 60_000);
  const total = loot.data?.loot.reduce((n, l) => n + l.value, 0) ?? 0;
  const price = (v: number | null) => (v == null ? <span className="faint">not listed</span> : coins(v));

  return (
    <main>
      <div className="head">
        <h1>Drops</h1>
        <div className="row">
          <Switch
            label="Whose loot"
            value={scope}
            onChange={setScope}
            options={[
              ['group', 'Everyone'],
              ['me', 'Just me'],
            ]}
          />
          <Switch label="Time window" value={window} onChange={setWindow} options={WINDOW_OPTIONS} />
          <a className="button" href={exportUrl.drops(scope)} download data-tip="Every drop, one row each, for Excel or Google Sheets.">
            Download CSV
          </a>
        </div>
      </div>

      <div className="grid-3-2 loot-grid">
        <section className="panel">
          <header>
            <h2>Drops</h2>
            <span className="muted">Worth {coins(total)} in total</span>
          </header>
          {!loot.data ? (
            <Loading error={loot.error} />
          ) : loot.data.loot.length === 0 ? (
            <Empty>No drops in this window.</Empty>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Count</th>
                      <th className="num">Value</th>
                      <th className="num opt">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loot.data.loot.map((l) => (
                      <tr key={l.item}>
                        <td>{l.name}</td>
                        <td className="num">{int(l.count)}</td>
                        <td className="num">{coins(l.value)}</td>
                        <td className="num muted opt">{total > 0 ? `${((l.value / total) * 100).toFixed(1)}%` : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="faint" style={{ marginTop: 10 }}>
            Priced at what they were worth when they dropped.
          </p>
        </section>

        <section className="panel">
          <header>
            <h2>Current prices</h2>
            <span className="muted">
              {prices.data?.updatedAt ? `Bazaar snapshot ${ago(prices.data.updatedAt, now)}` : 'No Bazaar snapshot yet, using NPC prices'}
            </span>
          </header>
          {!prices.data ? (
            <Loading error={prices.error} />
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Instant sell</th>
                      <th className="num opt">Sell offer</th>
                      <th className="num opt">NPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Arachne Crystal
                        <span className="sub">Cost of its recipe</span>
                      </td>
                      <td className="num">{coins(prices.data.crystalCost.instant)}</td>
                      <td className="num opt">{coins(prices.data.crystalCost.offer)}</td>
                      <td className="num opt">{coins(prices.data.crystalCost.npc)}</td>
                    </tr>
                    {prices.data.items
                      .filter((p) => p.item !== 'ARACHNE_CRYSTAL')
                      .map((p) => (
                        <tr key={p.item}>
                          <td>{p.name}</td>
                          <td className="num">{price(p.instant)}</td>
                          <td className="num opt">{price(p.offer)}</td>
                          <td className="num opt">{p.npc == null ? <span className="faint">–</span> : coins(p.npc)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="grid-2">
        <Panel title="How often things drop">
          {!pro ? <ProLock what="Drop rates" preview={<DropRatesPanel rates={fakeDropRates()} />} /> : rates.data ? <DropRatesPanel rates={rates.data} /> : <Loading error={rates.error} />}
        </Panel>
        <div className="stack">
          <Panel title="If you had sold differently" side={<span className="muted">same drops, other prices</span>}>
            {!pro ? <ProLock what="If you had sold differently" preview={<WhatIf data={fakeWhatIf()} />} /> : whatIf.data ? <WhatIf data={whatIf.data} /> : <Loading error={whatIf.error} />}
          </Panel>
          <Panel title="Bazaar today" side={<span className="muted">change in 24 hours</span>}>
            {movers.data ? <Market items={movers.data.items} /> : <Loading error={movers.error} />}
          </Panel>
        </div>
      </div>
    </main>
  );
}
