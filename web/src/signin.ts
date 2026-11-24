/*
 * /signin on the dashboard host. One page for the whole way in:
 *   signed out          → Continue with Discord (/auth/discord), or the test login when DEV_AUTH is on
 *   ?login=denied|failed → what went wrong (the Discord callback sends people back here via the dashboard)
 *   signed in, no terms  → accept the terms and confirm age (POST /api/consent), or sign out
 *   signed in and done   → straight on to the dashboard
 * The dashboard sends signed-out visitors here, so this replaces its old login screen.
 */
import { dashboard, el, onDashboardHost, whoAmI, type Me } from './site.ts';

const box = document.getElementById('signin')!;
const params = new URLSearchParams(location.search);

const DISCORD =
  '<svg class="discord-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1L18 21a19.7 19.7 0 0 0 6-3c.5-5.1-.8-9.6-3.7-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
}

function heading(title: string, lede: string) {
  return [el('h1', 'px', title), el('p', 'lede', lede)];
}

function smallPrint() {
  const p = el('p', 'signin-small');
  p.innerHTML = 'By signing in you agree to the <a href="/terms">Terms</a>, and you have read the <a href="/privacy">Privacy</a> and <a href="/cookies">Cookie</a> notices.';
  return p;
}

function signedOut(me: Me) {
  const parts: HTMLElement[] = heading('Sign in', me.openSignup ? 'Sign in with Discord to see your numbers, join a group and pair the mod.' : 'The dashboard is invite only for now. Sign in with Discord and the admin is asked to let you in.');

  const result = params.get('login');
  if (result === 'denied') {
    const note = el('p', 'note');
    note.append("You're not on the list yet, so the admin has been asked to let you in. Try again once they have.");
    const id = params.get('id');
    if (id) {
      note.append(' Your Discord ID: ');
      note.append(el('code', '', id));
    }
    note.append(' Until then the mod still works on its own and tracks your drops in game.');
    parts.push(note);
  } else if (result === 'failed') {
    parts.push(el('p', 'note bad', "Discord sign-in didn't finish. Try again."));
  }

  if (me.discord) {
    const a = el('a', 'btn btn-main');
    a.href = '/auth/discord';
    a.innerHTML = `${DISCORD}<span>Continue with Discord</span>`;
    // Discord takes a moment to open; show that the click registered.
    a.addEventListener('click', () => {
      a.setAttribute('aria-busy', 'true');
      a.querySelector('span')!.textContent = 'Opening Discord…';
    });
    parts.push(a);
  } else if (!me.devAuth) {
    parts.push(el('p', 'note bad', "Discord sign-in isn't set up on this server yet."));
  }

  if (me.devAuth) {
    if (me.discord) parts.push(el('div', 'or', 'or'));
    const form = el('form');
    const field = el('div', 'field');
    const label = el('label', 'px field-label', 'Test login (DEV_AUTH)');
    label.htmlFor = 'dev-name';
    const input = el('input', 'input');
    input.id = 'dev-name';
    input.value = 'dev';
    input.maxLength = 32;
    input.autocomplete = 'off';
    field.append(label, input);
    const go = el('button', 'btn btn-ghost', 'Log in');
    go.type = 'submit';
    const err = el('p', 'note bad');
    err.hidden = true;
    form.append(field, go, err);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go.disabled = true;
      go.textContent = 'Logging in…';
      err.hidden = true;
      post('/auth/dev-login', { name: input.value.trim() || 'dev' })
        .then(() => void render())
        .catch(() => {
          err.textContent = 'Test login failed. Is the server running?';
          err.hidden = false;
          go.disabled = false;
          go.textContent = 'Log in';
        });
    });
    parts.push(form);
  }

  parts.push(el('div', 'signin-rule'));
  const more = el('p', 'signin-small');
  more.innerHTML = 'New here? <a href="/download">Download the mod</a> first. It works on its own, and signing in adds the website.';
  parts.push(more, smallPrint());
  box.replaceChildren(...parts);
}

function terms(me: Me) {
  const user = me.user!;
  const parts: HTMLElement[] = heading('Before you start', 'One quick step, asked once and again only when the terms change.');
  const who = el('div', 'who');
  if (user.avatar) {
    const img = el('img');
    img.src = user.avatar;
    img.alt = '';
    who.append(img);
  }
  const name = el('div');
  name.append(el('div', 'px', user.name), el('div', 'muted small', 'Signed in with Discord'));
  who.append(name);
  parts.push(who);

  const info = el('div', 'prose small');
  info.append(
    el('p', 'soft', 'Arachne.fyi keeps your Discord name and picture, your Minecraft name, and the Arachne fights and drops your mod sends. You decide who else can see your numbers, and you can download or delete everything at any time in Settings.'),
    el('p', 'muted', "Your kills, drops and coins always count towards the anonymous totals on the home page. They are sums with no names in them, so this can't be turned off. The site only uses the cookies it needs to log you in."),
  );
  parts.push(info);

  const checks = el('div', 'checks');
  const check = (id: string, html: string) => {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.id = id;
    const text = el('span');
    text.innerHTML = html;
    label.append(input, text);
    checks.append(label);
    return input;
  };
  const agree = check('agree', 'I agree to the <a href="/terms">Terms of use</a>, and I have read the <a href="/privacy">Privacy notice</a> and <a href="/cookies">Cookie notice</a>.');
  const age = check('age', 'I am 13 or older.');
  parts.push(checks);

  const err = el('p', 'note bad');
  err.hidden = true;
  const go = el('button', 'btn btn-main', 'Agree and continue');
  go.type = 'button';
  go.disabled = true;
  const sync = () => (go.disabled = !agree.checked || !age.checked);
  agree.addEventListener('change', sync);
  age.addEventListener('change', sync);
  go.addEventListener('click', () => {
    go.disabled = true;
    go.textContent = 'Saving…';
    err.hidden = true;
    post('/api/consent', { terms: true, age: true })
      .then(() => location.replace(dashboard))
      .catch(() => {
        err.textContent = 'That did not save. Try again.';
        err.hidden = false;
        go.textContent = 'Agree and continue';
        sync();
      });
  });
  const out = el('button', 'btn btn-ghost', 'Sign out');
  out.type = 'button';
  out.addEventListener('click', () => void post('/auth/logout', {}).finally(() => void render()));
  parts.push(err, go, out);
  box.replaceChildren(...parts);
}

async function render() {
  // The login cookie belongs to the dashboard host, so signing in always happens there.
  if (!onDashboardHost) return location.replace(`${dashboard}signin${location.search}`);
  const me = await whoAmI();
  if (!me) {
    box.replaceChildren(...heading('Sign in', ''), el('p', 'note bad', "The server didn't answer. It may be restarting; try again in a moment."));
    return;
  }
  if (!me.user) return signedOut(me);
  if (me.consent && !me.consent.accepted) return terms(me);
  box.replaceChildren(...heading('Signed in', 'Opening your dashboard…'));
  location.replace(dashboard);
}

void render();
