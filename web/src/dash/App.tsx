/* The new dashboard (app host): top bar, routes, and the "viewing as" banner. */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { api, setViewingAs, setViewingAsFree, viewingAs, viewingAsFree, type Me } from '../api.ts';
import { closeStream, useLive, usePath } from '../hooks.ts';
import { useSettings } from '../settings.ts';
import { setPlan, usePlan } from '../components/Locked.tsx';
import { platform, type Group } from '../platform-api.ts';
import { pickGroup, previewNew, saveGroup, savedGroup, setPreviewNew, type User } from './data.ts';
import { Avatar } from './ui.tsx';
import { Home } from './Home.tsx';
import { MePage } from './Me.tsx';
import { Graphs } from './Graphs.tsx';
import { Standby } from './Standby.tsx';
import { SettingsPage } from './Settings.tsx';
import { AdminPage } from './Admin.tsx';
import { GroupSettings, JoinPage, Start } from './Groups.tsx';
import { ProPage } from './Pro.tsx';

export type Go = (to: string) => void;

/** Old addresses from the previous dashboard, sent somewhere that exists now. */
const MOVED: Record<string, string> = {
  '/overview': '/',
  '/leaderboard': '/',
  '/loot': '/me',
  '/fights': '/me',
  '/feed': '/',
  '/records': '/me',
  '/glance': '/standby',
  '/wrapped': '/me',
  '/account': '/me',
  '/groups': '/',
  '/pairing': '/settings#mod',
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [path, go] = usePath();
  useSettings(); // re-render when number style or time zone changes

  const loadMe = useCallback(
    (tries = 3): Promise<void> =>
      api
        .me()
        .then((m) => {
          setPlan(m.plan);
          setMe(m);
          setFailed(false);
        })
        .catch(() => (tries > 1 ? new Promise<void>((ok) => setTimeout(() => ok(loadMe(tries - 1)), 2000)) : setFailed(true))),
    [],
  );
  useEffect(() => void loadMe(), [loadMe]);

  if (failed) {
    return (
      <main className="dpage dpage-narrow">
        <p className="note bad">
          The server did not answer. Check it is running, then{' '}
          <button type="button" className="linkbtn" onClick={() => void loadMe()}>
            try again
          </button>
          .
        </p>
      </main>
    );
  }
  if (!me) return null;
  if (!me.user) {
    // A join link opened while signed out: remember it for after sign-in.
    const join = /^\/join\/([A-Za-z0-9]{6})$/.exec(path);
    if (join) sessionStorage.setItem('pendingJoin', join[1]!.toUpperCase());
    window.location.replace(`/signin${window.location.search}`);
    return null;
  }
  if (me.consent && !me.consent.accepted) {
    window.location.replace('/signin');
    return null;
  }
  const bare = path.split('#')[0]!.replace(/(.)\/$/, '$1');
  const moved = MOVED[bare];
  if (moved) window.history.replaceState(null, '', moved);
  return <SignedIn me={me} user={me.user} path={moved ? moved.split('#')[0]! : bare} go={go} />;
}

const GROUP = /^\/groups\/(\d+)$/;
const GROUP_SETTINGS = /^\/groups\/(\d+)\/settings$/;
const JOIN = /^\/join\/([A-Za-z0-9]{6})$/;

function SignedIn({ me, user, path, go }: { me: Me; user: User; path: string; go: Go }) {
  const preview = previewNew();
  const groupsLive = useLive(() => (preview ? Promise.resolve({ groups: [] as Group[] }) : platform.groups()), [], 60_000);
  const [want, setWant] = useState<number | null>(savedGroup);

  const openId = Number(GROUP.exec(path)?.[1] ?? GROUP_SETTINGS.exec(path)?.[1] ?? 0) || null;
  useEffect(() => {
    if (openId) {
      setWant(openId);
      saveGroup(openId);
    }
  }, [openId]);
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingJoin');
    if (pending) {
      sessionStorage.removeItem('pendingJoin');
      go(`/join/${pending}`);
    }
  }, [go]);

  const groups = groupsLive.data?.groups;
  const group = groups ? pickGroup(groups, want) : null;
  const choose = (id: number) => {
    setWant(id);
    saveGroup(id);
    go('/');
  };
  const refreshGroups = groupsLive.refresh;

  if (path === '/standby') return <Standby user={user} group={group} exit={() => go('/')} />;

  const joinCode = JOIN.exec(path)?.[1]?.toUpperCase();
  const settingsId = Number(GROUP_SETTINGS.exec(path)?.[1] ?? 0) || null;
  const isAdmin = user.role === 'admin';

  let page: ReactNode;
  if (!groups) page = <main className="dpage" aria-busy="true" />;
  else if (joinCode) page = <JoinPage code={joinCode} go={go} onJoined={(id) => (refreshGroups(), choose(id))} preview={preview} />;
  else if (path === '/start') page = <Start user={user} go={go} onCreated={(id) => (refreshGroups(), choose(id))} preview={preview} />;
  else if (settingsId) {
    const g = groups.find((x) => x.id === settingsId);
    page = g ? <GroupSettings group={g} user={user} go={go} onChanged={refreshGroups} /> : <NotFound go={go} />;
  } else if (path === '/' || openId) page = group ? <Home group={group} user={user} go={go} /> : <Start user={user} go={go} onCreated={(id) => (refreshGroups(), choose(id))} preview={preview} />;
  else if (path === '/me') page = preview ? <Start user={user} go={go} onCreated={() => undefined} preview /> : <MePage user={user} groups={groups} go={go} />;
  else if (path === '/graphs') page = <Graphs user={user} group={group} go={go} />;
  else if (path === '/pro') page = <ProPage user={user} go={go} />;
  else if (path === '/settings') page = <SettingsPage user={user} me={me} go={go} />;
  else if (path === '/admin' && isAdmin) page = <AdminPage user={user} me={me} />;
  else page = <NotFound go={go} />;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <ViewBanner />
      <Announcement />
      <TopBar user={user} path={path} go={go} groups={groups ?? []} group={group} choose={choose} />
      <div id="main" style={{ display: 'contents' }}>
        {page}
      </div>
      <footer className="dfoot">
        <div className="dfoot-in">
          <a href="/download">Download the mod</a>
          <a href="/help">Help</a>
          <a href="/changelog">What's new</a>
          <a href="/status">Status</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </div>
      </footer>
    </>
  );
}

/** Shown while an admin previews the site as someone else, as a free user, or as a brand-new user. */
function ViewBanner() {
  const as = viewingAs();
  const bits: [string, () => void][] = [];
  if (previewNew()) bits.push(['Viewing as a new user: this is what someone sees before pairing the mod or joining a group. Buttons here change nothing.', () => setPreviewNew(false)]);
  if (viewingAsFree()) bits.push(['Viewing as a free user: Pro parts show their locked preview.', () => setViewingAsFree(false)]);
  if (as) bits.push([`Viewing as ${as.name}: pages show their numbers.`, () => setViewingAs(null)]);
  if (!bits.length) return null;
  return (
    <>
      {bits.map(([text, exit]) => (
        <div className="banner" role="status" key={text}>
          <div className="banner-in">
            <span>{text}</span>
            <button type="button" className="btn btn-ghost btn-small" onClick={exit}>
              Exit
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/** One line from the admin, shown to everyone. */
function Announcement() {
  const a = useLive(api.announcement, [], 120_000);
  const x = a.data?.announcement;
  if (!x) return null;
  return (
    <div className="banner info" role="status">
      <div className="banner-in">
        <span>{x.text}</span>
        <span className="tiny muted">{x.by}</span>
      </div>
    </div>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, close]);
  return box;
}

export const linkTo = (go: Go, to: string) => (e: MouseEvent) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(to);
};

function TopBar({ user, path, go, groups, group, choose }: { user: User; path: string; go: Go; groups: Group[]; group: Group | null; choose: (id: number) => void }) {
  const plan = usePlan();
  const [gOpen, setGOpen] = useState(false);
  const [uOpen, setUOpen] = useState(false);
  const gBox = useClickAway(gOpen, useCallback(() => setGOpen(false), []));
  const uBox = useClickAway(uOpen, useCallback(() => setUOpen(false), []));
  const as = viewingAs();
  const tab = (to: string, label: string, on: boolean) => (
    <a href={to} className="px dtab" aria-current={on ? 'page' : undefined} onClick={linkTo(go, to)}>
      {label}
    </a>
  );
  const logout = () => {
    closeStream();
    void api.logout().then(() => window.location.replace('/signin'));
  };
  const menuLink = (to: string, label: string) => (
    <a
      href={to}
      className="mi"
      role="menuitem"
      onClick={(e) => {
        setUOpen(false);
        linkTo(go, to)(e);
      }}
    >
      {label}
    </a>
  );

  return (
    <header className="dtop">
      <div className="dtop-in">
        <a href="/" className="px logo" onClick={linkTo(go, '/')} aria-label="Arachne.fyi: group home">
          arachne<span>.fyi</span>
        </a>
        <nav className="dtabs" aria-label="Dashboard">
          {tab('/', 'Group', path === '/' || GROUP.test(path))}
          {tab('/me', 'Me', path === '/me')}
          {tab('/graphs', 'Graphs', path === '/graphs')}
        </nav>
        <div className="pop" ref={gBox}>
          <button type="button" className="chipbtn" aria-haspopup="menu" aria-expanded={gOpen} onClick={() => setGOpen(!gOpen)}>
            {group ? (
              <>
                <span className="gtag">{group.tag}</span>
                <span className="chip-name">{group.name}</span>
              </>
            ) : (
              <span className="chip-name">No group yet</span>
            )}
            <span className="chev" aria-hidden="true" />
          </button>
          {gOpen && (
            <div className="menu" role="menu" aria-label="Your groups">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  className="mi"
                  aria-current={g.id === group?.id}
                  onClick={() => {
                    setGOpen(false);
                    choose(g.id);
                  }}
                >
                  <span className="gtag">{g.tag}</span>
                  <span className="grow">{g.name}</span>
                  <span className="muted tiny">
                    {g.members} / {g.max}
                  </span>
                </button>
              ))}
              {groups.length > 0 && <hr />}
              {group && group.role !== 'member' && (
                <a
                  href={`/groups/${group.id}/settings`}
                  className="mi"
                  role="menuitem"
                  onClick={(e) => {
                    setGOpen(false);
                    linkTo(go, `/groups/${group.id}/settings`)(e);
                  }}
                >
                  Manage {group.name}
                </a>
              )}
              {group && group.role === 'member' && (
                <a
                  href={`/groups/${group.id}/settings`}
                  className="mi"
                  role="menuitem"
                  onClick={(e) => {
                    setGOpen(false);
                    linkTo(go, `/groups/${group.id}/settings`)(e);
                  }}
                >
                  About {group.name}
                </a>
              )}
              <a
                href="/start"
                className="mi"
                role="menuitem"
                onClick={(e) => {
                  setGOpen(false);
                  linkTo(go, '/start')(e);
                }}
              >
                <span className="hot">+</span> Join or create a group
              </a>
            </div>
          )}
        </div>
        <a href="/standby" className="btn btn-ghost hide-phone" onClick={linkTo(go, '/standby')} title="Standby: a big-number board for a spare phone or screen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M8 10v4M12 10v4M16 10v4" />
          </svg>
          Standby
        </a>
        <div className="pop" ref={uBox}>
          <button type="button" className="chipbtn" aria-haspopup="menu" aria-expanded={uOpen} onClick={() => setUOpen(!uOpen)} aria-label={`${as?.name ?? user.name}: account menu`}>
            <Avatar name={as?.name ?? user.name} src={as ? null : user.avatar} />
            <span className="chip-name hide-phone">{as?.name ?? user.name}</span>
          </button>
          {uOpen && (
            <div className="menu" role="menu" aria-label="Account">
              <div className="muted tiny" style={{ padding: '4px 10px 8px' }}>
                Signed in as {user.name} · {plan.plan === 'pro' ? 'Pro' : 'Free'}
              </div>
              {menuLink('/me', 'My profile')}
              {menuLink('/standby', 'Standby')}
              {plan.plan !== 'pro' && menuLink('/pro', 'Get Pro')}
              {menuLink('/settings', 'Settings')}
              {menuLink('/settings#mod', 'Pair the mod')}
              {user.role === 'admin' && menuLink('/admin', 'Admin')}
              <hr />
              <a href="/download" className="mi" role="menuitem">
                Download the mod
              </a>
              <a href="/help" className="mi" role="menuitem">
                Help
              </a>
              <hr />
              <button type="button" className="mi" role="menuitem" onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function NotFound({ go }: { go: Go }) {
  return (
    <main className="dpage dpage-narrow">
      <section className="panel card">
        <h1 className="px dh2">Nothing here</h1>
        <p className="soft">That page doesn't exist, or it belongs to a group you're not in.</p>
        <div>
          <button type="button" className="btn btn-main" onClick={() => go('/')}>
            Go to your group
          </button>
        </div>
      </section>
    </main>
  );
}
