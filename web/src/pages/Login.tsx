import { useState } from 'react';
import { api, type Me } from '../api.ts';

/** Shown to anyone not logged in. Same menu-screen layout as the landing page. */
export function Login({ me, onLogin }: { me: Me; onLogin: () => void }) {
  const [name, setName] = useState('dev');
  const [busy, setBusy] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const params = new URLSearchParams(window.location.search);
  const result = params.get('login');
  const deniedId = params.get('id');

  return (
    <div className="solo">
      <div />
      <div className="solo-body">
        <main className="panel menu-screen">
          <div className="title">
            <h1 className="wordmark">
              <span>Arachne</span>.fyi
            </h1>
            <p className="muted">{me.openSignup ? 'Log in with Discord to start.' : 'Invite only for now.'}</p>
          </div>
          <div className="rule" aria-hidden="true" />
          <div className="actions">
            {result === 'denied' && (
              <p className="note">
                You're not on the list yet, so the admin has been asked to let you in. Try again once they have.
                {deniedId && (
                  <>
                    {' '}
                    Your Discord ID: <code>{deniedId}</code>
                  </>
                )}{' '}
                Until then you can still use the mod on its own: it tracks your drops in game.
              </p>
            )}
            {result === 'failed' && <p className="note bad">Discord login didn't finish. Try again.</p>}

            {me.discord && (
              <a
                className={busy ? 'button primary busy' : 'button primary'}
                href="/auth/discord"
                // Discord takes a moment to open; show that the click registered.
                onClick={() => setBusy(true)}
              >
                <DiscordIcon />
                {busy ? 'Opening Discord…' : 'Log in with Discord'}
              </a>
            )}
            {!me.discord && !me.devAuth && <p className="note bad">Discord login isn't set up on this server yet.</p>}

            {me.devAuth && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  setDevError(null);
                  api
                    .devLogin(name.trim() || 'dev')
                    .then(onLogin)
                    .catch(() => setDevError('Test login failed. Is the server running?'))
                    .finally(() => setBusy(false));
                }}
              >
                <label>
                  Test login (DEV_AUTH)
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
                </label>
                <button type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? 'Logging in…' : 'Log in'}
                </button>
                {devError && <p className="note bad">{devError}</p>}
              </form>
            )}

            <a className="button" href="/download">
              Download the mod
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Discord's logo mark, for the login button. */
function DiscordIcon() {
  return (
    <svg className="discord-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1L18 21a19.7 19.7 0 0 0 6-3c.5-5.1-.8-9.6-3.7-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
