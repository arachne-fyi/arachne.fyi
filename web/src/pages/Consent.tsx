import { useState } from 'react';
import { api } from '../api.ts';
import { Loading, Panel, Toggle } from '../components/Bits.tsx';
import { useLive } from '../hooks.ts';
import { siteBase } from '../chrome.ts';
import { platform } from '../platform-api.ts';

/** Asked once after logging in, and again only when the terms change. Nothing else loads first. */
export function ConsentGate({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = siteBase();
  return (
    <div className="solo">
      <div />
      <div className="solo-body">
        <main className="panel menu-screen consent">
          <div className="title">
            <h1 className="wordmark">
              <span>Arachne</span>.fyi
            </h1>
            <p className="muted">Before you start</p>
          </div>
          <div className="rule" aria-hidden="true" />
          <div className="consent-body">
            <p>
              Arachne.fyi keeps your Discord name and picture, your Minecraft name, and the Arachne fights and drops your mod sends. You decide who else can see your
              numbers, and you can download or delete everything at any time in Settings.
            </p>
            <p className="muted">
              Your kills, drops and coins always count towards the anonymous totals on the home page. They are sums with no names in them, so this can't be turned off.
              The site only uses the cookies it needs to log you in.
            </p>
            <label className="check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                I agree to the <a href={`${base}/terms`}>Terms of use</a>, and I have read the <a href={`${base}/privacy`}>Privacy notice</a> and{' '}
                <a href={`${base}/cookies`}>Cookie notice</a>.
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
              <span>I am 13 or older.</span>
            </label>
            {err && <p className="note bad">{err}</p>}
          </div>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!terms || !age || busy}
              aria-busy={busy}
              onClick={() => {
                setBusy(true);
                platform
                  .acceptTerms()
                  .then(onDone)
                  .catch(() => setErr('That did not save. Try again.'))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Saving…' : 'Agree and continue'}
            </button>
            <button type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Who else sees your numbers. The anonymous totals are not part of this. */
export function PrivacyPanel() {
  const p = useLive(platform.privacy, []);
  if (!p.data) return <Panel title="Privacy"><Loading error={p.error} /></Panel>;
  return (
    <Panel title="Privacy">
      <div className="setting">
        <div>
          <b>Show me to other people</b>
          <div className="muted">
            Off: you are left off the leaderboard, feed, challenges and your groups' numbers, and the mod won't show your tag to others. You still see your own numbers.
            The anonymous totals on the home page always include everyone.
          </div>
        </div>
        <Toggle label="Show me to other people" on={p.data.visible} onChange={(on) => void platform.setPrivacy(on).then(p.refresh)} />
      </div>
    </Panel>
  );
}

/** Right to erasure: everything about you, gone, after typing DELETE. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error' | 'admin'>('idle');
  return (
    <div className="setting danger-zone">
      <div>
        <b>Delete my account</b>
        <div className="muted">
          Removes your account, paired accounts, every fight and drop, tokens, groups you own (passed to another member if there is one), comments and settings. Your
          share of the anonymous totals stays as a plain number. This can't be undone. You can also email{' '}
          <a href="mailto:contact@arachne.fyi?subject=Delete%20my%20data">contact@arachne.fyi</a>.
        </div>
        {open && (
          <form
            className="row"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              setState('busy');
              platform
                .deleteMe()
                .then(() => {
                  window.location.href = `${siteBase() || ''}/?deleted=1`;
                })
                .catch((err: Error) => setState(err.message === 'last_admin' ? 'admin' : 'error'));
            }}
          >
            <input aria-label="Type DELETE" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE" />
            <button type="submit" className="danger" disabled={typed !== 'DELETE' || state === 'busy'} aria-busy={state === 'busy'}>
              {state === 'busy' ? 'Deleting…' : 'Delete everything'}
            </button>
          </form>
        )}
        {state === 'error' && <p className="note bad">That didn't work. Try again, or email us.</p>}
        {state === 'admin' && <p className="note bad">You are the only admin. Make someone else an admin first.</p>}
      </div>
      {!open && (
        <button type="button" className="danger" onClick={() => setOpen(true)}>
          Delete…
        </button>
      )}
    </div>
  );
}

void api;
