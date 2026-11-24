/* Settings: plan, display, profile, notifications, privacy, sharing, the mod, your data. The same settings as before, in the new look. */
import { useEffect, useState } from 'react';
import { api, exportUrl, type Me, type Notify } from '../api.ts';
import { coins, dateTime, dayLabel } from '../format.ts';
import { closeStream, useLive } from '../hooks.ts';
import { disablePush, enablePush, pushState, type PushState } from '../push.ts';
import { useSettings } from '../settings.ts';
import { usePlan } from '../components/Locked.tsx';
import { platform, type PublicField } from '../platform-api.ts';
import { parseCoins, previewNew, type User } from './data.ts';
import { Card, CopyButton, Dropdown, Loading, Seg, Setting, Toggle } from './ui.tsx';
import { PairCode } from './Groups.tsx';
import type { Go } from './App.tsx';

const SECTIONS = [
  ['plan', 'Plan'],
  ['display', 'Display'],
  ['profile', 'Profile'],
  ['notify', 'Notifications'],
  ['privacy', 'Privacy'],
  ['sharing', 'Sharing'],
  ['mod', 'Mod'],
  ['data', 'Your data'],
] as const;

export function SettingsPage({ user, me: _me, go: _go }: { user: User; me: Me; go: Go }) {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
  }, []);
  const preview = previewNew();
  return (
    <main className="dpage dpage-narrow">
      <div className="dhead-words">
        <h1 className="px dh1">Settings</h1>
        <p className="soft">Signed in with Discord as {user.name}.</p>
      </div>
      <nav className="side-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} className="chip px" href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <PlanCard />
      <DisplayCard />
      <ProfileCard />
      <PushCard />
      <DiscordCard />
      <PrivacyCard />
      <SharingCard />
      <ModCard preview={preview} />
      <DataCard />
    </main>
  );
}

function PlanCard() {
  const plan = usePlan();
  const p = useLive(platform.plan, [], 0);
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
  return (
    <Card id="plan" title="Plan">
      <Setting
        title={plan.plan === 'pro' ? 'Pro' : 'Free'}
        note={
          plan.plan === 'pro'
            ? plan.until
              ? `Until ${dayLabel(plan.until)}.`
              : plan.source === 'founder'
                ? 'For being here from the start.'
                : 'No end date.'
            : 'Pro adds the Graphs page: every member as a line, projections and your drops against the wiki.'
        }
      >
        {plan.plan !== 'pro' && (
          <a className="btn btn-main" href="/pro">
            Get Pro · $4.99 once
          </a>
        )}
      </Setting>
      {p.data && (
        <Setting title="Groups" note={`You own ${p.data.owned} of ${p.data.limits.owned} and are in ${p.data.joined} of ${p.data.limits.joined} your plan allows.`} />
      )}
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          platform
            .redeem(code.trim())
            .then((r) => {
              setMsg({ ok: true, text: `Done: ${r.days} days of Pro added.` });
              setCode('');
              setTimeout(() => window.location.reload(), 1200);
            })
            .catch((err: Error) => setMsg({ ok: false, text: words[err.message] ?? 'That did not work. Try again.' }))
            .finally(() => setBusy(false));
        }}
      >
        <div className="setting-words">
          <b>Redeem a code</b>
          <span className="muted small">Codes give Pro time.</span>
        </div>
        <div className="setting-control">
          <input className="input" style={{ width: 200 }} aria-label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ARF-XXXX-XXXX" maxLength={20} />
          <button type="submit" className="btn btn-main" disabled={busy || code.trim().length < 4}>
            {busy ? 'Checking…' : 'Redeem'}
          </button>
        </div>
      </form>
      {msg && <p className={msg.ok ? 'note' : 'note bad'}>{msg.text}</p>}
    </Card>
  );
}

function DisplayCard() {
  const [s, set] = useSettings();
  return (
    <Card id="display" title="Display">
      <Setting title="Numbers" note="Saved in this browser.">
        <Seg
          label="Numbers"
          value={s.numbers}
          options={[
            ['short', '1.23M'],
            ['full', '1,234,567'],
          ]}
          onChange={(numbers) => set({ numbers })}
        />
      </Setting>
      <Setting title="Times" note="Days on the site start at 00:00 UTC either way.">
        <Seg
          label="Times"
          value={s.tz}
          options={[
            ['local', 'This computer'],
            ['utc', 'UTC'],
          ]}
          onChange={(tz) => set({ tz })}
        />
      </Setting>
    </Card>
  );
}

function ProfileCard() {
  const p = useLive(platform.prefs, [], 0);
  const [err, setErr] = useState<string | null>(null);
  if (!p.data) return <Card id="profile" title="Profile"><Loading error={p.error} /></Card>;
  const unlocked = p.data.titles.filter((t) => t.unlocked);
  return (
    <Card id="profile" title="Profile">
      <Setting title="Title" note={`Shown under your name. ${p.data.titles.length - unlocked.length} more to unlock by farming.`}>
        <Dropdown
          label="Title"
          value={p.data.title ?? ''}
          options={[['', `Automatic (${p.data.shownTitle})`] as const, ...unlocked.map((t) => [t.id, t.name] as const)]}
          onChange={(title) => {
            setErr(null);
            platform
              .setPrefs({ title: title || null })
              .then(p.refresh)
              .catch(() => setErr("That title isn't unlocked yet."));
          }}
        />
      </Setting>
      <Setting title="Value Arachne's Armor as Spider Essence" note="Each piece salvages into 5 Essence. Changes your totals and per-hour numbers.">
        <Toggle label="Value armour as essence" on={p.data.armour === 'ESSENCE'} onChange={(on) => void platform.setPrefs({ armour: on ? 'ESSENCE' : 'ITEM' }).then(p.refresh)} />
      </Setting>
      {err && <p className="note bad">{err}</p>}
    </Card>
  );
}

const PUSH_WORDS: Record<PushState, [string, string]> = {
  on: ['On', 'This browser gets your notifications.'],
  off: ['Off', 'Turn on to get your notifications on this device.'],
  blocked: ['Blocked', 'The browser is blocking this site. Allow Notifications in the site settings (the icon next to the address), then reload.'],
  unsupported: ['Not supported', "This browser can't show notifications from websites."],
  install: ['Needs the app', 'On iPhone and iPad: Share, Add to Home Screen, then open Arachne.fyi from the Home Screen.'],
  server: ['Server not ready', "The server can't send notifications yet. Run start.bat again so it installs web-push."],
};

function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = () => void pushState().then(setState).catch(() => setState('unsupported'));
  useEffect(check, []);
  return (
    <Card id="notify" title="Notifications on this device">
      <Setting title={state ? PUSH_WORDS[state][0] : '…'} note={state ? PUSH_WORDS[state][1] : 'Checking…'}>
        {(state === 'on' || state === 'off') && (
          <Toggle
            label="Notifications on this device"
            on={state === 'on'}
            disabled={busy}
            onChange={(next) => {
              setBusy(true);
              const task = next ? enablePush() : disablePush().then(() => 'Off.');
              void task
                .then(setMsg)
                .catch((e: Error) => setMsg(`That didn't work: ${e.message}`))
                .finally(() => {
                  setBusy(false);
                  check();
                });
            }}
          />
        )}
        {state === 'on' && (
          <button type="button" className="btn btn-ghost" onClick={() => void api.testNotify().then(() => setMsg('Sent. It should appear in a few seconds.')).catch(() => setMsg('The server could not send it.'))}>
            Send a test
          </button>
        )}
      </Setting>
      {msg && <p className="note">{msg}</p>}
    </Card>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`] as const);

function DiscordCard() {
  const n = useLive(api.notify, [], 0);
  const [draft, setDraft] = useState<Partial<Notify>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'bad' | 'tested'>('idle');
  if (!n.data) return <Card title="What gets sent"><Loading error={n.error} /></Card>;
  const v = { ...n.data, ...draft };
  const set = (patch: Partial<Notify>) => {
    setDraft({ ...draft, ...patch });
    setState('idle');
  };
  const onOff = (key: 'rare' | 'recap' | 'offline' | 'digest', title: string, note: string) => (
    <Setting title={title} note={note}>
      <Toggle label={title} on={v[key]} onChange={(on) => set({ [key]: on })} />
    </Setting>
  );
  return (
    <Card title="What gets sent">
      <span className="muted small">These apply to this device and to Discord. For Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL, then paste it here.</span>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setState('saving');
          api
            .saveNotify(v)
            .then(() => {
              setState('saved');
              setDraft({});
              n.refresh();
            })
            .catch(() => setState('bad'));
        }}
      >
        <Setting title="Discord webhook" note={n.data.hasWebhook ? 'Saved. Paste a new one to change it, or clear it to stop Discord messages.' : 'Not set: nothing is sent to Discord.'}>
          <input className="input" aria-label="Webhook URL" value={v.webhook} onChange={(e) => set({ webhook: e.target.value })} placeholder="https://discord.com/api/webhooks/…" style={{ width: 'min(360px, 100%)' }} />
        </Setting>
        {onOff('rare', "Arachne's special drops", "Dark Queen's Soul, the fangs and the pets.")}
        <Setting title="Drops worth at least" note="Any drop worth this much or more. Empty for none.">
          <input className="input" style={{ width: 140 }} aria-label="Drop value" value={v.minCoins > 0 ? coins(v.minCoins) : ''} onChange={(e) => set({ minCoins: parseCoins(e.target.value) })} placeholder="e.g. 1m" />
        </Setting>
        {onOff('recap', 'Session recap', 'A summary when you stop farming for 10 minutes.')}
        {onOff('offline', 'Mod went quiet', 'If the mod stops reporting while you are in the Sanctuary (crash, disconnect).')}
        {onOff('digest', 'Weekly digest', 'Your week, every Monday morning.')}
        <Setting title="Quiet hours (UTC)" note="No drop or recap messages between these hours. Same hour twice for none.">
          <Dropdown small label="Quiet from" value={v.quietFrom} options={HOURS} onChange={(quietFrom) => set({ quietFrom })} />
          <span className="muted">to</span>
          <Dropdown small label="Quiet to" value={v.quietTo} options={HOURS} onChange={(quietTo) => set({ quietTo })} />
        </Setting>
        <div className="row-gap">
          <button type="submit" className="btn btn-main" disabled={state === 'saving'}>
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {n.data.hasWebhook && (
            <button type="button" className="btn btn-ghost" onClick={() => void api.testNotify().then(() => setState('tested'))}>
              Send a test
            </button>
          )}
          {state === 'saved' && <span className="gain">Saved.</span>}
          {state === 'tested' && <span className="gain">Sent. Check the channel.</span>}
          {state === 'bad' && <span className="loss">That is not a Discord webhook URL.</span>}
        </div>
      </form>
    </Card>
  );
}

function PrivacyCard() {
  const p = useLive(platform.privacy, [], 0);
  return (
    <Card id="privacy" title="Privacy">
      {!p.data ? (
        <Loading error={p.error} />
      ) : (
        <Setting title="Show my numbers to my groups" note="Off: your groups still list you, but your numbers are hidden and left out of the group totals.">
          <Toggle label="Show my numbers to my groups" on={p.data.visible} onChange={(on) => void platform.setPrivacy(on).then(p.refresh)} />
        </Setting>
      )}
    </Card>
  );
}

const FIELD_WORDS: Record<PublicField, string> = {
  title: 'Title',
  profit: 'Profit',
  kills: 'Kills',
  perHour: 'Profit per hour',
  crystals: 'Crystals placed',
  callings: 'Callings placed',
  time: 'Time farming',
  bestDrop: 'Best drop',
  lastSeen: 'Last seen',
  badges: 'Badges',
  accounts: 'Each Minecraft account (shows account names)',
};

const OV_FIELDS: [string, string, string][] = [
  ['profit', 'Profit today', '42.1M'],
  ['kills', 'Kills', '128'],
  ['rate', 'Per hour', '9.8M'],
  ['time', 'Farming', '4h 18m'],
  ['crystals', 'Crystals', '96'],
  ['callings', 'Callings', '32'],
  ['loot', 'Loot', '61.4M'],
  ['costs', 'Spent', '19.3M'],
  ['week', 'This week', '210M'],
  ['weekKills', 'Kills this week', '655'],
  ['last', 'Last kill', '2 min ago'],
];

function SharingCard() {
  const sh = useLive(api.sharing, [], 0);
  const prefs = useLive(platform.prefs, [], 0);
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!sh.data) return <Card id="sharing" title="Sharing"><Loading error={sh.error} /></Card>;
  const base = window.location.origin;
  const overlay = sh.data.overlayKey ? `${base}/overlay/${sh.data.overlayKey}` : null;
  const value = name ?? sh.data.publicName ?? '';
  const shown = new Set(prefs.data?.public ?? []);
  const setField = (f: PublicField, on: boolean) => {
    const next = new Set(shown);
    if (on) next.add(f);
    else next.delete(f);
    void platform.setPrefs({ public: [...next] }).then(prefs.refresh);
  };
  return (
    <Card id="sharing" title="Sharing">
      <Setting title="Stream overlay" note="A box with today's numbers for OBS: add it as a Browser source. Anyone with the link can see those numbers.">
        <button type="button" className="btn btn-ghost" onClick={() => void api.setSharing({ overlay: 'new' }).then(sh.refresh)}>
          {overlay ? 'New link' : 'Make a link'}
        </button>
        {overlay && (
          <button type="button" className="btn btn-ghost" onClick={() => void api.setSharing({ overlay: 'off' }).then(sh.refresh)}>
            Turn off
          </button>
        )}
      </Setting>
      {overlay && <OverlayBuilder base={overlay} />}
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          api
            .setSharing({ publicName: value.trim().toLowerCase() })
            .then(() => {
              setMsg(value ? 'Saved.' : 'Profile turned off.');
              setName(null);
              sh.refresh();
            })
            .catch((err: Error) => setMsg(err.message === 'name_taken' ? 'Someone has that name.' : '3 to 24 letters, numbers, - or _.'));
        }}
      >
        <div className="setting-words">
          <b>Public profile</b>
          <span className="muted small">Off unless you pick a name. Clear the name to turn it off.</span>
          {sh.data.publicName && (
            <span className="muted small">
              <a href={`/u/${sh.data.publicName}`}>{`${base}/u/${sh.data.publicName}`}</a>
            </span>
          )}
        </div>
        <div className="setting-control">
          <input className="input" style={{ width: 180 }} aria-label="Profile name" value={value} onChange={(e) => setName(e.target.value)} placeholder="e.g. ollie" />
          <button type="submit" className="btn btn-ghost">
            Save
          </button>
        </div>
      </form>
      {msg && <p className="note">{msg}</p>}
      {sh.data.publicName && prefs.data && (
        <div className="stack">
          <b>What your public profile shows</b>
          <span className="muted small">Fields that are off are never sent to the page or to link previews.</span>
          {prefs.data.fields.map((f) => (
            <Setting key={f} title={<span style={{ fontWeight: 400 }}>{FIELD_WORDS[f]}</span>}>
              <Toggle label={FIELD_WORDS[f]} on={shown.has(f)} onChange={(on) => setField(f, on)} />
            </Setting>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Pick what the overlay shows and how it looks; the link carries the choices. */
function OverlayBuilder({ base }: { base: string }) {
  const [show, setShow] = useState<string[]>(['profit', 'kills', 'rate', 'time']);
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  const [layout, setLayout] = useState<'stack' | 'row'>('stack');
  const [theme, setTheme] = useState<'panel' | 'clear' | 'outline'>('panel');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const [title, setTitle] = useState('');
  const q = new URLSearchParams({ show: show.join(','), size, layout, theme, align });
  if (title.trim()) q.set('title', title.trim());
  const url = `${base}?${q.toString()}`;
  const toggle = (f: string) => setShow(show.includes(f) ? show.filter((x) => x !== f) : [...show, f]);
  const w = size === 's' ? 280 : size === 'm' ? 400 : 560;
  return (
    <div className="panel card" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <b>Overlay: show, in this order</b>
      <div className="checks">
        {OV_FIELDS.map(([f, label]) => (
          <label key={f} className="check">
            <input type="checkbox" checked={show.includes(f)} onChange={() => toggle(f)} />
            <span>
              {label}
              {show.includes(f) && <span className="muted"> #{show.indexOf(f) + 1}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="row-gap">
        <Seg label="Size" value={size} onChange={setSize} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
        <Seg label="Layout" value={layout} onChange={setLayout} options={[['stack', 'Stacked'], ['row', 'In a row']]} />
        <Seg label="Look" value={theme} onChange={setTheme} options={[['panel', 'Panel'], ['clear', 'See-through'], ['outline', 'Outline']]} />
        <Seg label="Align" value={align} onChange={setAlign} options={[['left', 'Left'], ['right', 'Right']]} />
      </div>
      <label className="field">
        <span className="field-label">Title line (optional)</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="e.g. Crystal grind" />
      </label>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted small">Preview with example numbers</span>
        <div className={`stream-box${layout === 'row' ? ' row' : ''}`} style={{ alignSelf: align === 'right' ? 'flex-end' : 'flex-start' }}>
          {title.trim() && <span className="muted small">{title.trim()}</span>}
          {show.map((f, i) => {
            const [, label, sample] = OV_FIELDS.find(([x]) => x === f)!;
            return (
              <span key={f}>
                <b className={i === 0 ? 'hot' : undefined}>{sample}</b> <span className="muted small">{label}</span>
              </span>
            );
          })}
        </div>
        <span className="muted tiny">
          In OBS: Browser source, width {w}, height {layout === 'row' ? 90 : 60 + show.length * (size === 'l' ? 34 : 26)}.
        </span>
      </div>
      <code className="mono code-line">{url}</code>
      <div className="row-gap">
        <CopyButton text={url} label="Copy link" main />
        <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
    </div>
  );
}

function ModCard({ preview }: { preview: boolean }) {
  const tokens = useLive(api.tokens, [], 0);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = (tokens.data?.tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <Card id="mod" title="Mod">
      <Setting title="Pair the mod" note={<>Get the mod on the <a href="/download">download page</a>, then type the code in Minecraft chat. One pairing covers every Minecraft account on that PC.</>} />
      <PairCode disabled={preview} />
      <div className="stack" style={{ marginTop: 8 }}>
        <b>Tokens</b>
        <span className="muted small">Each pairing makes a token. Revoke one to unpair that PC.</span>
        {!tokens.data ? (
          <Loading error={tokens.error} />
        ) : active.length === 0 ? (
          <p className="empty small">No tokens yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Starts</th>
                  <th className="hide-phone">Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((t) => (
                  <tr key={t.id}>
                    <td>{t.label}</td>
                    <td className="mono">{t.prefix}…</td>
                    <td className="muted hide-phone">{t.lastUsedAt ? dateTime(t.lastUsedAt) : 'never'}</td>
                    <td className="r">
                      <button type="button" className="btn btn-danger btn-small" onClick={() => window.confirm(`Revoke "${t.label}"? That PC stops sending data until it's paired again.`) && void api.revokeToken(t.id).then(tokens.refresh)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="row-gap"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            api
              .createToken(label.trim() || 'My PC')
              .then((m) => {
                setFresh(m.token);
                setLabel('');
                tokens.refresh();
              })
              .catch((x: Error) => setErr(x.message === 'too_many_tokens' ? 'You already have 10 active tokens. Revoke one first.' : 'Could not make a token.'));
          }}
        >
          <input className="input grow" style={{ flexBasis: 200 }} aria-label="Token name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Or make a long token: name it, e.g. Laptop" maxLength={40} />
          <button type="submit" className="btn btn-ghost" disabled={preview}>
            Make a token
          </button>
        </form>
        {fresh && (
          <div className="note stack">
            <b>Copy this now. It can't be shown again.</b>
            <code className="mono code-line">/arachne pair {tokens.data?.endpoint ?? ''} {fresh}</code>
            <div className="row-gap">
              <CopyButton text={`/arachne pair ${tokens.data?.endpoint ?? ''} ${fresh}`} label="Copy the pair command" main />
              <button type="button" className="btn btn-ghost" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        {err && <p className="note bad">{err}</p>}
      </div>
    </Card>
  );
}

function DataCard() {
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const signOut = () => {
    closeStream();
    void api.logout().then(() => window.location.replace('/signin'));
  };
  return (
    <Card id="data" title="Your data">
      <Setting title="Download" note="Everything the site keeps about you, or your drops and fights as spreadsheets.">
        <a className="btn btn-ghost" href={exportUrl.everything}>
          Everything (JSON)
        </a>
        <a className="btn btn-ghost" href={exportUrl.drops('me')}>
          Drops (CSV)
        </a>
        <a className="btn btn-ghost" href={exportUrl.fights('me')}>
          Fights (CSV)
        </a>
      </Setting>
      <Setting title="Sign out" note="On this browser.">
        <button type="button" className="btn btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </Setting>
      <form
        className="setting"
        onSubmit={(e) => {
          e.preventDefault();
          platform
            .deleteMe()
            .then(() => window.location.replace('/'))
            .catch(() => setErr("Couldn't delete the account. Try again."));
        }}
      >
        <div className="setting-words">
          <b>Delete my account</b>
          <span className="muted small">Removes your login, tokens and farming data. Groups you own pass to their longest-standing member, mods first. This can't be undone. Type DELETE to confirm.</span>
        </div>
        <div className="setting-control">
          <input className="input" style={{ width: 140 }} aria-label="Type DELETE" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
          <button type="submit" className="btn btn-danger" disabled={typed !== 'DELETE'}>
            Delete
          </button>
        </div>
      </form>
      {err && <p className="note bad">{err}</p>}
    </Card>
  );
}
