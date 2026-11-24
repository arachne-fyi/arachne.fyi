import { useState } from 'react';
import { undoable } from '../components/Undo.tsx';
import { api } from '../api.ts';
import { Loading } from '../components/Bits.tsx';
import { ago, dateTime } from '../format.ts';
import { useLive, useNow } from '../hooks.ts';

/** Make and revoke mod tokens. */
export function Pairing() {
  const tokens = useLive(api.tokens, []);
  const now = useNow(10_000);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const made = await api.createToken(label.trim() || 'My PC');
      setFresh(made.token);
      setCopied(false);
      setLabel('');
      tokens.refresh();
    } catch (err) {
      setError((err as Error).message === 'too_many_tokens' ? 'You already have 10 active tokens. Revoke one first.' : 'Could not create a token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Pair the mod</h1>

      <section className="panel">
        <header>
          <h2>Set up Minecraft</h2>
        </header>
        <ol className="steps">
          <li>
            Get the mod from the <a href="/download">download page</a> and put it in your <code>mods</code> folder with
            Fabric API.
          </li>
          <li>Make a token below. One token works for all your Minecraft accounts.</li>
          <li>Copy the line it gives you and paste it into Minecraft chat.</li>
          <li>Play. You show up here within a minute.</li>
        </ol>
      </section>

      <CodePairing />

      <section className="panel">
        <header>
          <h2>Tokens</h2>
        </header>
        {fresh && (
          <div className="note good" role="status" style={{ display: 'grid', gap: 10 }}>
            <p>
              <b>Copy this token now.</b> It is stored only as a hash, so it cannot be shown again.
            </p>
            <div className="code">{fresh}</div>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void navigator.clipboard.writeText(`/arachne pair ${tokens.data?.endpoint ?? ''} ${fresh}`);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy the pair command'}
              </button>
              <button type="button" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        <form
          className="row"
          style={{ margin: '1rem 0' }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            Name it after the computer
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My PC" maxLength={40} />
          </label>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
            {busy ? 'Creating…' : 'Create token'}
          </button>
        </form>
        {error && <p className="note bad">{error}</p>}
        {!tokens.data ? (
          <Loading error={tokens.error} />
        ) : (
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="opt">Starts with</th>
                    <th className="opt">Created</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.data.tokens.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No tokens yet.
                      </td>
                    </tr>
                  )}
                  {tokens.data.tokens.map((t) => (
                    <tr key={t.id} className={t.revokedAt ? 'faint' : undefined}>
                      <td>{t.label}</td>
                      <td className="opt">
                        <code>{t.prefix}…</code>
                      </td>
                      <td className="muted opt">{dateTime(t.createdAt)}</td>
                      <td className="muted">{t.lastUsedAt ? ago(t.lastUsedAt, now) : 'Never'}</td>
                      <td className="num">
                        {t.revokedAt ? (
                          <span className="tag">Revoked</span>
                        ) : (
                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              undoable(`Revoking "${t.label}". Mods using it stop syncing.`, () => void api.revokeToken(t.id).then(tokens.refresh))
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

    </main>
  );
}

/** The easy way: a six-letter code to type in game instead of a long token. */
function CodePairing() {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <header>
        <h2>Quick pairing</h2>
      </header>
      {code ? (
        <>
          <p>Type this in Minecraft chat within 10 minutes:</p>
          <p className="pair-code">
            <code>/arachne pair {code.code}</code>
          </p>
          <p className="muted">It works once. It makes a token called "Paired with a code" that you can revoke below.</p>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Get a short code instead of copying a long token.
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              void api
                .pairCode()
                .then(setCode)
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Making a code…' : 'Get a code'}
          </button>
        </>
      )}
    </section>
  );
}
