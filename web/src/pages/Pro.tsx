import { useState } from 'react';
import { api } from '../api.ts';
import { Loading, Panel } from '../components/Bits.tsx';
import { usePlan } from '../components/Locked.tsx';
import { useLive } from '../hooks.ts';
import { platform, type Code } from '../platform-api.ts';
import { ago, dayLabel } from '../format.ts';

const MONTHLY = 3.99;
const YEARLY = 29.99;
/** Yearly against twelve monthly payments: 29.99 / 47.88 is about 63%, a 37% saving. */
const SAVING = Math.round((1 - YEARLY / (MONTHLY * 12)) * 100);

const FREE = ['Overview, today and all time', 'Profit and kills graphs', 'Leaderboard, feed and challenges', 'Bazaar prices and price history', 'Join 3 groups, run 1', 'The mod, with every feature'];
const PRO = [
  'Everything in Free',
  'Best hours to farm, farming calendar and damage charts',
  'Drop rates against the wiki, with luck',
  '"If you had sold differently"',
  'Your year',
  'Join 10 groups, run 5',
  'No ads, ever',
];

/** Plans and codes. Payments are not switched on yet, so the buttons say so. */
export function Pro({ onRedeemed }: { onRedeemed: () => void }) {
  const plan = usePlan();
  return (
    <main>
      <div className="head">
        <h1>Pro</h1>
        {plan.plan === 'pro' && <span className="pro-tag">You have Pro{plan.until ? ` until ${dayLabel(plan.until)}` : ''}</span>}
      </div>
      <div className="plans">
        <section className="panel plan">
          <h2>Free</h2>
          <div className="price">$0</div>
          <ul>{FREE.map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
        <section className="panel plan plan-pro">
          <h2>Pro monthly</h2>
          <div className="price">
            ${MONTHLY}
            <small>/month</small>
          </div>
          <p className="muted">First month free. Cancel any time before it ends and you pay nothing.</p>
          <ul>{PRO.map((f) => <li key={f}>{f}</li>)}</ul>
          <button type="button" className="primary" disabled>
            Coming soon
          </button>
        </section>
        <section className="panel plan plan-pro">
          <h2>Pro yearly</h2>
          <div className="price">
            ${YEARLY}
            <small>/year</small>
          </div>
          <p className="muted">Charged once a year. {SAVING}% less than paying monthly for twelve months.</p>
          <ul>{PRO.map((f) => <li key={f}>{f}</li>)}</ul>
          <button type="button" className="primary" disabled>
            Coming soon
          </button>
        </section>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Prices in US dollars. Payments aren't open yet; codes from us unlock Pro in the meantime.
      </p>
      <Redeem onDone={onRedeemed} />
    </main>
  );
}

export function Redeem({ onDone, bare }: { onDone?: () => void; bare?: boolean }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const words: Record<string, string> = {
    unknown_code: "That code doesn't exist. Check for typos.",
    expired: 'That code has expired.',
    used_up: 'That code has been used up.',
    already_used: "You've already used that code.",
    slow_down: 'Too many tries. Wait a minute.',
  };
  const body = (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          platform
            .redeem(code.trim())
            .then((r) => {
              setMsg({ ok: true, text: `Done: ${r.days} days of Pro added.` });
              setCode('');
              onDone?.();
            })
            .catch((err: Error) => setMsg({ ok: false, text: words[err.message] ?? 'That did not work. Try again.' }))
            .finally(() => setBusy(false));
        }}
      >
        <input aria-label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ARF-XXXX-XXXX" maxLength={20} />
        <button type="submit" disabled={busy || code.trim().length < 4} aria-busy={busy}>
          {busy ? 'Checking…' : 'Redeem'}
        </button>
      </form>
      {msg && <p className={msg.ok ? 'note gain' : 'note bad'}>{msg.text}</p>}
    </>
  );
  return bare ? body : <Panel title="Redeem a code">{body}</Panel>;
}

/** Admin: make short-lived codes that give Pro time. */
export function CodesPanel() {
  const list = useLive(platform.adminCodes, []);
  const [o, setO] = useState({ days: 30, validMinutes: 10, maxUses: 1, count: 1, note: '' });
  const [made, setMade] = useState<string[]>([]);
  const num = (k: 'days' | 'validMinutes' | 'maxUses' | 'count', label: string, max: number) => (
    <label>
      {label}
      <input type="number" min={1} max={max} value={o[k]} onChange={(e) => setO({ ...o, [k]: Number(e.target.value) })} style={{ width: 90 }} />
    </label>
  );
  return (
    <Panel title="Pro codes">
      <form
        className="row code-form"
        onSubmit={(e) => {
          e.preventDefault();
          void platform.makeCodes(o).then((r) => {
            setMade(r.codes);
            list.refresh();
          });
        }}
      >
        {num('days', 'Pro days', 366)}
        {num('validMinutes', 'Valid for (minutes)', 10_080)}
        {num('maxUses', 'Uses each', 1000)}
        {num('count', 'How many', 20)}
        <label>
          Note
          <input value={o.note} onChange={(e) => setO({ ...o, note: e.target.value })} placeholder="e.g. giveaway" maxLength={80} />
        </label>
        <button type="submit" className="primary">
          Make
        </button>
      </form>
      {made.length > 0 && (
        <div className="note">
          {made.map((c) => (
            <code key={c} className="code-chip">
              {c}
            </code>
          ))}
          <button type="button" className="small" onClick={() => void navigator.clipboard.writeText(made.join('\n'))}>
            Copy
          </button>
        </div>
      )}
      {!list.data ? (
        <Loading error={list.error} />
      ) : list.data.codes.length === 0 ? (
        <p className="empty">No codes yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Gives</th>
                <th>Used</th>
                <th>Ends</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.codes.map((c: Code) => (
                <tr key={c.code} className={c.live ? undefined : 'faint'}>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>{c.days} days</td>
                  <td>
                    {c.uses} / {c.maxUses}
                  </td>
                  <td>{c.live ? `in ${Math.max(1, Math.round((c.expiresAt - Date.now()) / 60_000))} min` : c.expiresAt <= Date.now() ? `ended ${ago(c.expiresAt)}` : 'used up'}</td>
                  <td>{c.note}</td>
                  <td>
                    {c.live && (
                      <button type="button" className="small" onClick={() => void platform.revokeCode(c.code).then(list.refresh)}>
                        End now
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Admin: who has Pro, and whether anyone can sign up. */
export function PlansPanel() {
  const p = useLive(platform.adminPlans, []);
  const u = useLive(api.adminUsers, []);
  const users = u.data?.users ?? [];
  if (!p.data) return <Panel title="Plans and sign-up"><Loading error={p.error} /></Panel>;
  const byId = new Map(p.data.plans.map((x) => [x.userId, x]));
  return (
    <Panel title="Plans and sign-up">
      <div className="setting">
        <div>
          <b>Open sign-up</b>
          <div className="muted">On: anyone can log in with Discord and gets a free account. Off: only people you let in.</div>
        </div>
        <button type="button" className={p.data.openSignup ? undefined : 'primary'} onClick={() => void platform.setOpenSignup(!p.data!.openSignup).then(p.refresh)}>
          {p.data.openSignup ? 'Close sign-up' : 'Open sign-up'}
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Plan</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const x = byId.get(u.id);
              return (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>
                    {x?.plan === 'pro' ? 'Pro' : 'Free'}
                    {x?.plan === 'pro' && <span className="faint"> ({x.source}{x.until ? `, until ${dayLabel(x.until)}` : ''})</span>}
                  </td>
                  <td className="row">
                    {x?.plan !== 'pro' || (x.until != null && x.source !== 'admin') ? (
                      <button type="button" className="small" onClick={() => void platform.setPlan(u.id, 'pro').then(p.refresh)}>
                        Give Pro
                      </button>
                    ) : null}
                    <button type="button" className="small" onClick={() => void platform.setPlan(u.id, 'pro', 30).then(p.refresh)}>
                      +30 days
                    </button>
                    {x?.plan === 'pro' && x.source !== 'admin' && (
                      <button type="button" className="small" onClick={() => void platform.setPlan(u.id, 'free').then(p.refresh)}>
                        Make free
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
