import { useState } from 'react';
import { api, exportUrl, type Notify } from '../api.ts';
import { useLive } from '../hooks.ts';
import { disablePush, enablePush, pushState, type PushState } from '../push.ts';
import { useEffect } from 'react';
import { Loading, Panel, Switch, Toggle } from '../components/Bits.tsx';
import { parseCoins } from '../components/Extras.tsx';
import { coins } from '../format.ts';
import { useSettings } from '../settings.ts';
import { applyBackground } from '../chrome.ts';
import { DeleteAccount, PrivacyPanel } from './Consent.tsx';
import { Redeem } from './Pro.tsx';
import { usePlan } from '../components/Locked.tsx';
import { platform, type Prefs, type PublicField } from '../platform-api.ts';
import { useRef } from 'react';
import { dayLabel } from '../format.ts';

/** Choices that only affect this browser, and downloads of your data. */
export function Settings() {
  const [s, set] = useSettings();
  const [goal, setGoal] = useState(s.dailyGoal > 0 ? coins(s.dailyGoal) : '');

  return (
    <main>
      <div className="head">
        <h1>Settings</h1>
      </div>
      <p className="muted">Most of these only change this browser; privacy, notifications and sharing are saved to your account.</p>

      <PlanPanel />
      <TitlePanel />

      <Panel title="Numbers">
        <div className="setting">
          <div>
            <b>How coins are written</b>
            <div className="muted">Example: {s.numbers === 'short' ? '1.23M' : '1,234,567'}</div>
          </div>
          <Switch
            label="Number style"
            value={s.numbers}
            onChange={(numbers) => set({ numbers })}
            options={[
              ['short', '1.23M'],
              ['full', '1,234,567'],
            ]}
          />
        </div>
        <div className="setting">
          <div>
            <b>Real-money currency</b>
            <div className="muted">For the "in real money" line under your profit.</div>
          </div>
          <Switch
            label="Currency"
            value={s.currency}
            onChange={(currency) => set({ currency })}
            options={[
              ['GBP', '£ GBP'],
              ['USD', '$ USD'],
            ]}
          />
        </div>
        <div className="setting">
          <div>
            <b>Times</b>
            <div className="muted">"Today" always starts at midnight UTC; this only changes how clock times are shown.</div>
          </div>
          <Switch
            label="Time zone"
            value={s.tz}
            onChange={(tz) => set({ tz })}
            options={[
              ['local', 'My time'],
              ['utc', 'UTC'],
            ]}
          />
        </div>
        <form
          className="setting"
          onSubmit={(e) => {
            e.preventDefault();
            set({ dailyGoal: parseCoins(goal) });
          }}
        >
          <div>
            <b>Daily profit goal</b>
            <div className="muted">Shown as a bar on the Overview. Leave empty to hide it.</div>
          </div>
          <div className="row">
            <input aria-label="Daily goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. 20m" />
            <button type="submit">Save</button>
          </div>
        </form>
        <ArmourSetting />
      </Panel>

      <Panel title="Look">
        <div className="setting">
          <div>
            <b>Background</b>
            <div className="muted">The panorama loads after the still picture, and only on a fast connection. Reduced motion or data saver keeps the still picture.</div>
          </div>
          <Switch
            label="Background"
            value={s.background}
            onChange={(background) => {
              set({ background });
              applyBackground(background);
            }}
            options={[
              ['panorama', 'Panorama'],
              ['still', 'Still'],
              ['colour', 'Colour'],
            ]}
          />
        </div>
      </Panel>

      <Panel title="Rare drops">
        <div className="setting">
          <div>
            <b>Sound</b>
            <div className="muted">A short jingle when a rare drop lands while this page is open.</div>
          </div>
          <Toggle label="Sound" on={s.sound} onChange={(sound) => set({ sound })} />
        </div>
        <div className="setting">
          <div>
            <b>Animations</b>
            <div className="muted">The spider that runs across the screen, and confetti for milestones.</div>
          </div>
          <Toggle label="Animations" on={!s.calm} onChange={(on) => set({ calm: !on })} />
        </div>
      </Panel>

      <PushPanel />
      <Notifications />

      <PrivacyPanel />
      <Sharing />

      <Panel title="Your data">
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          Spreadsheets open in Excel or Google Sheets. Times are UTC.
        </p>
        <div className="row">
          <a className="button" href={exportUrl.drops('me')} download>
            My drops (CSV)
          </a>
          <a className="button" href={exportUrl.fights('me')} download>
            My fights (CSV)
          </a>
          <a className="button" href={exportUrl.everything} download>
            Everything about me (JSON)
          </a>
        </div>
        <DeleteAccount />
      </Panel>
    </main>
  );
}

/**
 * Messages to your own Discord channel. A webhook is the simplest route: no bot, no login.
 * Saved on the server (it sends them), unlike the rest of this page.
 */
function Notifications() {
  const n = useLive(api.notify, []);
  const [draft, setDraft] = useState<Partial<Notify>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'bad' | 'tested'>('idle');
  if (!n.data) return <Panel title="What to send"><Loading error={n.error} /></Panel>;
  const v = { ...n.data, ...draft };
  const set = (patch: Partial<Notify>) => {
    setDraft({ ...draft, ...patch });
    setState('idle');
  };
  const onOff = (key: 'rare' | 'recap' | 'dry' | 'offline' | 'digest', title: string, note: string) => (
    <div className="setting">
      <div>
        <b>{title}</b>
        <div className="muted">{note}</div>
      </div>
      <Toggle label={title} on={v[key]} onChange={(on) => set({ [key]: on })} />
    </div>
  );
  return (
    <Panel title="What to send">
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        These choices apply to notifications on your devices and to Discord. For Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL. Paste it here.
      </p>
      <form
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
        <div className="setting">
          <div>
            <b>Webhook URL</b>
            <div className="muted">{n.data.hasWebhook ? 'Saved. Paste a new one to change it, or clear it to stop all messages.' : 'Not set: no messages are sent.'}</div>
          </div>
          <input aria-label="Webhook URL" value={v.webhook} onChange={(e) => set({ webhook: e.target.value })} placeholder="https://discord.com/api/webhooks/…" style={{ width: 'min(420px, 100%)' }} />
        </div>
        {onOff('rare', 'Rare drops', "Dark Queen's Soul, Fang and Tarantula pets.")}
        <div className="setting">
          <div>
            <b>Big drops</b>
            <div className="muted">Also any drop worth at least this much. Empty for rare drops only.</div>
          </div>
          <input aria-label="Big drop value" value={v.minCoins > 0 ? coins(v.minCoins) : ''} onChange={(e) => set({ minCoins: parseCoins(e.target.value) })} placeholder="e.g. 1m" />
        </div>
        {onOff('recap', 'Session recap', 'A summary when you stop farming for 10 minutes.')}
        {onOff('dry', 'Dry streak alerts', "Every 100 kills without a Dark Queen's Soul, 250 for the others.")}
        {onOff('offline', 'Mod went quiet', 'If the mod stops reporting while you are in the Sanctuary (crash, disconnect).')}
        {onOff('digest', 'Weekly digest', 'Your week, every Monday morning.')}
        <div className="setting">
          <div>
            <b>Quiet hours (UTC)</b>
            <div className="muted">No drop or recap messages between these hours. Same number twice for none.</div>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <select aria-label="Quiet from" value={v.quietFrom} onChange={(e) => set({ quietFrom: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            <span>to</span>
            <select aria-label="Quiet to" value={v.quietTo} onChange={(e) => set({ quietTo: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button type="submit" className="primary" disabled={state === 'saving'} aria-busy={state === 'saving'}>
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {n.data.hasWebhook && (
            <button type="button" onClick={() => void api.testNotify().then(() => setState('tested'))}>
              Send a test
            </button>
          )}
          {state === 'saved' && <span className="gain">Saved.</span>}
          {state === 'tested' && <span className="gain">Sent. Check the channel.</span>}
          {state === 'bad' && <span className="loss">That is not a Discord webhook URL.</span>}
        </div>
      </form>
    </Panel>
  );
}

const PUSH_WORDS: Record<PushState, [string, string]> = {
  on: ['On', 'This browser gets your notifications.'],
  off: ['Off', 'Turn on to get rare drops, recaps and dry streaks here.'],
  blocked: ['Blocked', 'The browser is blocking this site. Click the lock icon next to the address, allow Notifications, then reload.'],
  unsupported: ['Not supported', "This browser can't show notifications from websites."],
  install: ['Needs the app', 'On iPhone and iPad: Share, Add to Home Screen, then open Arachne.fyi from the Home Screen.'],
  server: ['Server not ready', "The server can't send notifications yet. Run start.bat again so it installs web-push."],
};

/** Notifications in this browser (or the installed app on a phone). */
function PushPanel() {
  const [state, setState] = useState<PushState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = () => void pushState().then(setState).catch(() => setState('unsupported'));
  useEffect(check, []);
  const canToggle = state === 'on' || state === 'off';
  return (
    <Panel title="Notifications on this device">
      <div className="setting">
        <div>
          <b>
            <span className={`push-state push-${state ?? 'off'}`}>{state ? PUSH_WORDS[state][0] : '…'}</span>
          </b>
          <div className="muted">{state ? PUSH_WORDS[state][1] : 'Checking…'}</div>
        </div>
        <div className="row">
          {canToggle && (
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
            <button type="button" onClick={() => void api.testNotify().then(() => setMsg('Sent. It should appear in a few seconds.')).catch(() => setMsg('The server could not send it.'))}>
              Send a test
            </button>
          )}
        </div>
      </div>
      {msg && <p className="note">{msg}</p>}
    </Panel>
  );
}

/** A stream overlay link and an opt-in public profile with an image card. */
function Sharing() {
  const sh = useLive(api.sharing, []);
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!sh.data) return <Panel title="Sharing"><Loading error={sh.error} /></Panel>;
  const base = window.location.origin;
  const overlay = sh.data.overlayKey ? `${base}/overlay/${sh.data.overlayKey}` : null;
  const value = name ?? sh.data.publicName ?? '';
  return (
    <Panel title="Sharing">
      <div className="setting">
        <div>
          <b>Stream overlay</b>
          <div className="muted">
            A box with today's numbers for OBS: add it as a Browser source. Pick what it shows below. Anyone with the link can see those numbers.
          </div>
        </div>
        <div className="row">
          <button type="button" onClick={() => void api.setSharing({ overlay: 'new' }).then(sh.refresh)}>
            {overlay ? 'New link' : 'Make a link'}
          </button>
          {overlay && (
            <button type="button" onClick={() => void api.setSharing({ overlay: 'off' }).then(sh.refresh)}>
              Turn off
            </button>
          )}
        </div>
      </div>
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
        <div>
          <b>Public profile</b>
          <div className="muted">Off unless you pick a name. Shows all-time profit, kills and badges; no account names.</div>
          {sh.data.publicName && (
            <div className="muted">
              <a href={`/u/${sh.data.publicName}`}>{`${base}/u/${sh.data.publicName}`}</a>
              <br />
              Image card: <code className="wrap-code">{`${base}/api/public/card/${sh.data.publicName}.svg`}</code>
            </div>
          )}
        </div>
        <div className="row">
          <input aria-label="Profile name" value={value} onChange={(e) => setName(e.target.value)} placeholder="e.g. ollie" />
          <button type="submit">Save</button>
        </div>
      </form>
      {msg && <p className="note">{msg}</p>}
      {sh.data.publicName && <PublicFields />}
    </Panel>
  );
}

/** Free or Pro, and a box for codes. */
function PlanPanel() {
  const plan = usePlan();
  return (
    <Panel title="Plan" side={<a href="/pro">Compare plans</a>}>
      <p>
        {plan.plan === 'pro' ? (
          <>
            <b>Pro</b>
            {plan.until ? `, until ${dayLabel(plan.until)}` : plan.source === 'founder' ? ', for being here from the start' : ''}.
          </>
        ) : (
          <>
            <b>Free.</b> Pro adds more charts and insight.
          </>
        )}
      </p>
      <Redeem bare onDone={() => window.location.reload()} />
    </Panel>
  );
}

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

/** Pick what the overlay shows and how it looks; the link carries the choices. */
function OverlayBuilder({ base }: { base: string }) {
  const [show, setShow] = useState<string[]>(['profit', 'kills', 'rate', 'time']);
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  const [layout, setLayout] = useState<'stack' | 'row'>('stack');
  const [theme, setTheme] = useState<'panel' | 'clear' | 'outline'>('panel');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);
  const q = new URLSearchParams({ show: show.join(','), size, layout, theme, align });
  if (title.trim()) q.set('title', title.trim());
  const url = `${base}?${q.toString()}`;
  const toggle = (f: string) => setShow(show.includes(f) ? show.filter((x) => x !== f) : [...show, f]);
  const w = size === 's' ? 280 : size === 'm' ? 400 : 560;
  return (
    <div className="overlay-builder">
      <div className="ob-controls">
        <fieldset>
          <legend>Show, in this order</legend>
          <div className="ob-fields">
            {OV_FIELDS.map(([f, label]) => (
              <label key={f} className="check">
                <input type="checkbox" checked={show.includes(f)} onChange={() => toggle(f)} />
                <span>
                  {label}
                  {show.includes(f) && <span className="faint"> #{show.indexOf(f) + 1}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row ob-switches">
          <Switch label="Size" value={size} onChange={setSize} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
          <Switch label="Layout" value={layout} onChange={setLayout} options={[['stack', 'Stacked'], ['row', 'In a row']]} />
          <Switch label="Look" value={theme} onChange={setTheme} options={[['panel', 'Panel'], ['clear', 'See-through'], ['outline', 'Outline']]} />
          <Switch label="Align" value={align} onChange={setAlign} options={[['left', 'Left'], ['right', 'Right']]} />
        </div>
        <label>
          Title line (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="e.g. Crystal grind" />
        </label>
      </div>
      <div className="ob-preview" aria-label="Preview">
        <div className={`stream-box size-${size} layout-${layout} theme-${theme} align-${align}`}>
          {title.trim() && <div className="sb-title">{title.trim()}</div>}
          {show.map((f, i) => {
            const [, label, sample] = OV_FIELDS.find(([x]) => x === f)!;
            return (
              <div key={f} className={i === 0 ? 'sb-item sb-main' : 'sb-item'}>
                <span className="sb-value">{sample}</span>
                <span className="sb-label">{label}</span>
              </div>
            );
          })}
        </div>
        <p className="faint">Preview with example numbers. In OBS: Browser source, width {w}, height {layout === 'row' ? 90 : 60 + show.length * (size === 'l' ? 34 : 26)}.</p>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <code className="wrap-code">{url}</code>
        <button type="button" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a className="button" href={url}>
          Open
        </a>
      </div>
    </div>
  );
}

/**
 * Arachne's Armor as the item (NPC price) or as the 5 Spider Essence each piece salvages into.
 * Saved on the server: it changes your totals, per-hour figures, leaderboard and drop list.
 */
function ArmourSetting() {
  const p = useLive(platform.prefs, []);
  if (!p.data) return null;
  return (
    <div className="setting">
      <div>
        <b>Value Arachne's Armor as essence</b>
        <div className="muted">
          On: each armour piece counts as the 5 Spider Essence it salvages into, at the essence's Bazaar price when it dropped. Off: its NPC price (2,000). Accounts
          set to NPC prices or Ironman always use the NPC price. Changes all your past drops too.
        </div>
      </div>
      <Toggle label="Value armour as essence" on={p.data.armour === 'ESSENCE'} onChange={(on) => void platform.setPrefs({ armour: on ? 'ESSENCE' : 'ITEM' }).then(p.refresh)} />
    </div>
  );
}

/** Pick a title from the ones you've unlocked. More kinds of title can be added on the server. */
function TitlePanel() {
  const p = useLive(platform.prefs, []);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash === '#title') ref.current?.scrollIntoView();
  }, [p.data != null]);
  if (!p.data) return <Panel title="Your title"><Loading error={p.error} /></Panel>;
  const how = (t: Prefs['titles'][number]) => (t.unlock.kind === 'kills' ? `${t.unlock.min.toLocaleString('en-GB')} kills` : 'a badge');
  const pick = (title: string | null) => {
    setErr(null);
    platform.setPrefs({ title }).then(p.refresh).catch(() => setErr("That title isn't unlocked yet."));
  };
  return (
    <div ref={ref} id="title">
      <Panel title="Your title" side={<span className="muted">Showing: {p.data.shownTitle}</span>}>
        <div className="title-list" role="radiogroup" aria-label="Title">
          <button type="button" role="radio" aria-checked={p.data.title === null} className="title-pick" onClick={() => pick(null)}>
            <b>Automatic</b>
            <span className="muted">your kill-rank title</span>
          </button>
          {p.data.titles.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={p.data!.title === t.id} className="title-pick" disabled={!t.unlocked} onClick={() => pick(t.id)}>
              <b>{t.name}</b>
              <span className="muted">{t.unlocked ? 'unlocked' : `needs ${how(t)}`}</span>
            </button>
          ))}
        </div>
        {err && <p className="note bad">{err}</p>}
      </Panel>
    </div>
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

/** Which parts of the public profile anyone can see. */
function PublicFields() {
  const p = useLive(platform.prefs, []);
  if (!p.data) return null;
  const on = new Set(p.data.public);
  const set = (f: PublicField, v: boolean) => {
    const next = new Set(on);
    if (v) next.add(f);
    else next.delete(f);
    void platform.setPrefs({ public: [...next] }).then(p.refresh);
  };
  return (
    <div className="public-fields">
      <b>What your public profile shows</b>
      <div className="muted">Off fields are never sent to the page or to link previews.</div>
      {p.data.fields.map((f) => (
        <div key={f} className="setting compact">
          <span>{FIELD_WORDS[f]}</span>
          <Toggle label={FIELD_WORDS[f]} on={on.has(f)} onChange={(v) => set(f, v)} />
        </div>
      ))}
    </div>
  );
}
