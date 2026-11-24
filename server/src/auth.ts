import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

export interface User {
  id: number;
  discord_id: string;
  name: string;
  avatar: string | null;
  role: 'admin' | 'user';
  disabled: number;
  created_at?: number;
  last_login_at?: number | null;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const TOKEN_PREFIX = 'al_';
export const SESSION_COOKIE = 'al_session';

/**
 * Two kinds of credential, both stored only as a SHA-256 hash:
 *
 *  - Mod tokens (`al_...`): made on the dashboard, pasted into the mod, sent as a Bearer
 *    header with every batch. Per person, revocable, never expire on their own.
 *  - Sessions: an HttpOnly cookie set after Discord login, for the dashboard only.
 *
 * Both are 256 random bits, so a plain hash is enough; there is nothing to brute-force.
 */
export class Auth {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  // ---- users / allowlist -------------------------------------------------------------

  userById(id: number): User | undefined {
    return this.db.get<User>('SELECT * FROM state.users WHERE id = ?', id);
  }

  listUsers(): User[] {
    return this.db.all<User>('SELECT * FROM state.users ORDER BY id');
  }

  /** Add a Discord ID to the allowlist. The name is filled in on their first login. */
  allow(discordId: string, role: 'admin' | 'user', now: number, name = ''): User {
    this.db.run(
      `INSERT INTO state.users (discord_id, name, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET role = excluded.role, disabled = 0`,
      discordId,
      name,
      role,
      now,
    );
    return this.db.get<User>('SELECT * FROM state.users WHERE discord_id = ?', discordId)!;
  }

  updateUser(id: number, patch: { role?: 'admin' | 'user'; disabled?: boolean }): void {
    if (patch.role) this.db.run('UPDATE state.users SET role = ? WHERE id = ?', patch.role, id);
    if (patch.disabled !== undefined) {
      this.db.run('UPDATE state.users SET disabled = ? WHERE id = ?', patch.disabled ? 1 : 0, id);
      // Disabling someone must cut off their open dashboard sessions too.
      if (patch.disabled) this.db.run('DELETE FROM state.sessions WHERE user_id = ?', id);
    }
  }

  /**
   * Called after Discord has vouched for an identity. Returns the user if they may log in.
   * Admins listed in ADMIN_DISCORD_IDS are created on the fly; everyone else must
   * already be on the allowlist.
   */
  login(profile: { id: string; name: string; avatar: string | null }, now: number): User | null {
    if (this.config.adminDiscordIds.includes(profile.id)) this.allow(profile.id, 'admin', now);
    const user = this.db.get<User>('SELECT * FROM state.users WHERE discord_id = ?', profile.id);
    if (!user || user.disabled) return null;
    this.db.run(
      'UPDATE state.users SET name = ?, avatar = ?, last_login_at = ? WHERE id = ?',
      profile.name,
      profile.avatar,
      now,
      user.id,
    );
    return { ...user, name: profile.name, avatar: profile.avatar };
  }

  // ---- sessions ----------------------------------------------------------------------

  createSession(userId: number, now: number): { cookie: string; expiresAt: number } {
    const cookie = randomToken();
    const expiresAt = now + this.config.sessionDays * 86_400_000;
    this.db.run(
      'INSERT INTO state.sessions (hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      sha256(cookie),
      userId,
      now,
      expiresAt,
    );
    return { cookie, expiresAt };
  }

  sessionUser(cookie: string | undefined, now: number): User | null {
    if (!cookie) return null;
    const user = this.db.get<User>(
      `SELECT u.* FROM state.sessions s JOIN state.users u ON u.id = s.user_id
       WHERE s.hash = ? AND s.expires_at > ? AND u.disabled = 0`,
      sha256(cookie),
      now,
    );
    return user ?? null;
  }

  destroySession(cookie: string | undefined): void {
    if (cookie) this.db.run('DELETE FROM state.sessions WHERE hash = ?', sha256(cookie));
  }

  pruneSessions(now: number): void {
    this.db.run('DELETE FROM state.sessions WHERE expires_at <= ?', now);
  }

  // ---- mod tokens --------------------------------------------------------------------

  /** Returns the plain token once. Only its hash is kept. */
  createToken(userId: number, label: string, now: number): { id: number; token: string } {
    const token = TOKEN_PREFIX + randomToken();
    const res = this.db.run(
      'INSERT INTO state.tokens (user_id, label, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)',
      userId,
      label,
      sha256(token),
      token.slice(0, 9),
      now,
    );
    return { id: Number(res.lastInsertRowid), token };
  }

  listTokens(userId: number) {
    return this.db.all<{
      id: number;
      label: string;
      prefix: string;
      created_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>(
      'SELECT id, label, prefix, created_at, last_used_at, revoked_at FROM state.tokens WHERE user_id = ? ORDER BY id DESC',
      userId,
    );
  }

  revokeToken(userId: number, tokenId: number, now: number, asAdmin = false): boolean {
    const res = asAdmin
      ? this.db.run('UPDATE state.tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, tokenId)
      : this.db.run(
          'UPDATE state.tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
          now,
          tokenId,
          userId,
        );
    return res.changes > 0;
  }

  /** Resolve an `Authorization: Bearer al_...` header to its user. */
  tokenUser(header: string | undefined, now: number): User | null {
    const match = /^Bearer\s+(al_[A-Za-z0-9_-]{20,})$/.exec(header ?? '');
    if (!match) return null;
    const row = this.db.get<User & { token_id: number }>(
      `SELECT u.*, t.id AS token_id FROM state.tokens t JOIN state.users u ON u.id = t.user_id
       WHERE t.hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
      sha256(match[1]!),
    );
    if (!row) return null;
    this.db.run('UPDATE state.tokens SET last_used_at = ? WHERE id = ?', now, row.token_id);
    return row;
  }
}
