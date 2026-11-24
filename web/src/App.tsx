import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api, setViewingAs, setViewingAsFree, viewingAs, viewingAsFree, type Me } from './api.ts';
import { closeStream, usePath } from './hooks.ts';
import { Account } from './pages/Account.tsx';
import { Admin } from './pages/Admin.tsx';
import { Fights } from './pages/Fights.tsx';
import { Palette, Tour } from './components/Palette.tsx';
import { TouchHelpers } from './components/Touch.tsx';
import { OfflineBar, UndoToast } from './components/Undo.tsx';
import { Feed } from './pages/Feed.tsx';
import { Glance } from './pages/Glance.tsx';
import { Wrapped } from './pages/Wrapped.tsx';
import { Konami } from './components/Konami.tsx';
import { Graphs } from './pages/Graphs.tsx';
import { Leaderboard } from './pages/Leaderboard.tsx';
import { Loot } from './pages/Loot.tsx';
import { Overview } from './pages/Overview.tsx';
import { Pairing } from './pages/Pairing.tsx';
import { Records } from './pages/Records.tsx';
import { Settings } from './pages/Settings.tsx';
import { useSettings } from './settings.ts';
import { setPlan, usePlan } from './components/Locked.tsx';
import { Groups, JoinPage } from './pages/Groups.tsx';
import { Pro } from './pages/Pro.tsx';
import { Standby } from './pages/Standby.tsx';

type User = NonNullable<Me['user']>;

const TABS = [
  ['/', 'Overview'],
  ['/graphs', 'Graphs'],
  ['/leaderboard', 'Leaderboard'],
  ['/loot', 'Drops'],
  ['/fights', 'Fights'],
  ['/feed', 'Feed'],
  ['/groups', 'Groups'],
  ['/records', 'Progress'],
] as const;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [path, go] = usePath();
  // Re-render everything when a setting changes (number style, currency, ...).
  useSettings();

  // A blip (server restarting, "slow down") shouldn't leave a dead page: try a few times first.
  const loadMe = (tries = 3): Promise<void> =>
    api
      .me()
      .then((m) => {
        setPlan(m.plan);
        setMe(m);
        setFailed(false);
      })
      .catch(() => (tries > 1 ? new Promise<void>((ok) => setTimeout(() => ok(loadMe(tries - 1)), 2000)) : setFailed(true)));
  useEffect(() => void loadMe(), []);

  if (failed) {
    return (
      <main>
        <p className="note bad">
          The server did not answer. Check it is running, then{' '}
          <button type="button" className="small" onClick={() => void loadMe()}>
            try again
          </button>
        </p>
      </main>
    );
  }
  if (!me) return null;
  if (!me.user) {
    // A join link opened while logged out: remember it for after the Discord login.
    const join = /^\/join\/([A-Za-z0-9]{6})$/.exec(path);
    if (join) sessionStorage.setItem('pendingJoin', join[1]!.toUpperCase());
    // Signing in has its own page in the new site style (signin.html), which also shows ?login=failed|denied.
    window.location.replace(`/signin${window.location.search}`);
    return null;
  }
  if (me.consent && !me.consent.accepted) {
    // The terms step lives on the sign-in page too.
    window.location.replace('/signin');
    return null;
  }

  const user = me.user;
  return <LoggedIn user={user} path={path} go={go} loadMe={loadMe} />;
}

const KNOWN = new Set(['/', '/graphs', '/leaderboard', '/loot', '/fights', '/feed', '/groups', '/pro', '/standby', '/records', '/settings', '/glance', '/wrapped', '/account', '/pairing', '/admin']);
const GROUP_PAGE = /^\/groups\/(\d+)$/;
const JOIN_PAGE = /^\/join\/([A-Za-z0-9]{6})$/;

function LoggedIn({ user, path, go, loadMe }: { user: User; path: string; go: (to: string) => void; loadMe: () => void }) {
  const link = (to: string) => (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.button !== 0) return; // let "open in new tab" work
    e.preventDefault();
    go(to);
  };
  const logout = () => {
    closeStream();
    void api.logout().then(() => loadMe());
  };
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingJoin');
    if (pending) {
      sessionStorage.removeItem('pendingJoin');
      go(`/join/${pending}`);
    }
  }, []);
  const groupId = GROUP_PAGE.exec(path)?.[1];
  const joinCode = JOIN_PAGE.exec(path)?.[1]?.toUpperCase();

  // Standby is the whole screen: no tabs, no footer.
  if (path === '/standby') return <Standby exit={() => go('/')} me={user} />;

  return (
    <>
      <OfflineBar />
      <ViewAsBar />
      <TouchHelpers />
      <Konami />
      <UndoToast />
      <Tour />
      <Palette go={go} admin={user.role === 'admin'} />
      <header className="topbar">
        <a className="logo" href="/" onClick={link('/')}>
          <img src="/favicon.png" alt="" className="pixel-icon" />
          <span className="logo-text">
            <span>Arachne</span>.fyi
          </span>
        </a>
        <nav className="tabs" aria-label="Pages">
          {TABS.map(([to, label]) => (
            <a key={to} href={to} onClick={link(to)} aria-current={path === to || (to === '/groups' && !!groupId) ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <ProfileMenu user={user} link={link} onLogout={logout} />
      </header>
      {path === '/graphs' ? (
        <Graphs />
      ) : path === '/leaderboard' ? (
        <Leaderboard />
      ) : path === '/loot' ? (
        <Loot />
      ) : path === '/fights' ? (
        <Fights />
      ) : path === '/groups' || groupId ? (
        <Groups go={go} open={groupId ? Number(groupId) : null} meId={user.id} />
      ) : joinCode ? (
        <JoinPage code={joinCode} go={go} />
      ) : path === '/pro' ? (
        <Pro onRedeemed={loadMe} />
      ) : path === '/account' ? (
        <Account me={user} />
      ) : !KNOWN.has(path) || (path === '/admin' && user.role !== 'admin') ? (
        <NotFound go={go} />
      ) : path === '/wrapped' ? (
        <Wrapped />
      ) : path === '/glance' ? (
        <Glance me={user} />
      ) : path === '/feed' ? (
        <Feed me={user} />
      ) : path === '/records' ? (
        <Records />
      ) : path === '/settings' ? (
        <Settings />
      ) : path === '/pairing' ? (
        <Pairing />
      ) : path === '/admin' && user.role === 'admin' ? (
        <Admin me={user} />
      ) : (
        <Overview me={user} goPairing={() => go('/pairing')} />
      )}
    </>
  );
}

/** While an admin is looking at the site as someone else, or anyone is previewing the free plan. */
function ViewAsBar() {
  const v = viewingAs();
  if (viewingAsFree()) {
    return (
      <div className="offline-bar view-as" role="status">
        Viewing as a free user: this is what the free plan shows.{' '}
        <button type="button" className="small" onClick={() => setViewingAsFree(false)}>
          Stop
        </button>
      </div>
    );
  }
  if (!v) return null;
  return (
    <div className="offline-bar view-as" role="status">
      Viewing as {v.name}: "Just me" shows their numbers.{' '}
      <button type="button" className="small" onClick={() => setViewingAs(null)}>
        Stop
      </button>
    </div>
  );
}

function NotFound({ go }: { go: (to: string) => void }) {
  return (
    <main>
      <div className="panel card" style={{ margin: '40px auto' }}>
        <h1>Nothing here</h1>
        <p className="muted">That page doesn't exist. The link may be old.</p>
        <button type="button" className="primary" onClick={() => go('/')}>
          Go to the Overview
        </button>
      </div>
    </main>
  );
}

/** Your Discord picture and name; click for the account menu. */
function ProfileMenu({ user, link, onLogout }: { user: User; link: (to: string) => (e: MouseEvent) => void; onLogout: () => void }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = (to: string, label: string) => (
    <a
      href={to}
      onClick={(e) => {
        setOpen(false);
        link(to)(e);
      }}
    >
      {label}
    </a>
  );

  return (
    <div className="me" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {user.avatar ? (
          <img className="avatar" src={user.avatar} alt="" />
        ) : (
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="name">{user.name}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {item('/account', 'My accounts')}
          {item('/pairing', 'Pair the mod')}
          {item('/glance', 'Glance (phone view)')}
          {item('/wrapped', 'Your year')}
          {item('/standby', 'Standby (phone on its side)')}
          {item('/pro', user.role === 'admin' ? 'Pro and codes' : 'Pro')}
          {(user.role === 'admin' || plan.plan === 'pro' || viewingAsFree()) && (
            <button type="button" onClick={() => setViewingAsFree(!viewingAsFree())}>
              {viewingAsFree() ? 'Stop viewing as free user' : 'View as free user'}
            </button>
          )}
          {item('/settings', 'Settings')}
          <a href="/download" onClick={() => setOpen(false)}>
            Download the mod
          </a>
          <a href="/changelog" onClick={() => setOpen(false)}>
            What's new
          </a>
          {user.role === 'admin' && item('/admin', 'Admin')}
          <hr />
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
