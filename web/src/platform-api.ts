import type { Totals, WindowTotals } from '@arachne/shared';
import { request } from './api.ts';

/** Calls for groups, plans, codes, consent and your data. Shapes mirror server/src/platform.ts. */

export interface Plan {
  plan: 'free' | 'pro';
  until: number | null;
  source: string;
  limits: { owned: number; joined: number };
  owned: number;
  joined: number;
  proPaths: string[];
}

export interface Group {
  id: number;
  name: string;
  tag: string;
  description: string;
  role: 'owner' | 'mod' | 'member';
  showTag: boolean;
  members: number;
  max: number;
  /** Only owners and mods see the join code. */
  code: string | null;
}

export interface GroupMember {
  userId: number;
  name: string;
  role: Group['role'];
  joinedAt: number;
  hidden: boolean;
  today: Totals | null;
  week: Totals | null;
  all: Totals | null;
}

export interface Code {
  code: string;
  days: number;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  note: string;
  live: boolean;
}

export type PublicField = 'title' | 'profit' | 'kills' | 'perHour' | 'crystals' | 'callings' | 'time' | 'bestDrop' | 'lastSeen' | 'badges' | 'accounts';

export interface Prefs {
  armour: 'ITEM' | 'ESSENCE';
  title: string | null;
  public: PublicField[];
  fields: PublicField[];
  titles: { id: string; name: string; unlocked: boolean; unlock: { kind: 'kills'; min: number } | { kind: 'badge'; badge: string } }[];
  shownTitle: string;
}

export const platform = {
  prefs: () => request<Prefs>('GET', '/api/me/prefs'),
  setPrefs: (p: Partial<Pick<Prefs, 'armour' | 'title' | 'public'>>) => request<{ ok: true }>('PUT', '/api/me/prefs', p),
  postToDiscord: (window: 'today' | 'week' | 'all') => request<{ ok: true }>('POST', '/api/me/share/discord', { window }),
  purge: (everything: boolean) => request<{ ok: true; files: number }>('POST', '/api/admin/purge', { confirm: 'PURGE', everything }),
  acceptTerms: () => request<{ ok: true }>('POST', '/api/consent', { terms: true, age: true }),
  plan: () => request<Plan>('GET', '/api/me/plan'),
  privacy: () => request<{ visible: boolean }>('GET', '/api/me/privacy'),
  setPrivacy: (visible: boolean) => request<{ ok: true }>('PUT', '/api/me/privacy', { visible }),
  deleteMe: () => request<{ ok: true }>('POST', '/api/me/delete', { confirm: 'DELETE' }),
  redeem: (code: string) => request<{ ok: true; days: number }>('POST', '/api/redeem', { code }),

  groups: () => request<{ groups: Group[] }>('GET', '/api/groups'),
  group: (id: number) => request<{ group: Group; members: GroupMember[]; totals: WindowTotals }>('GET', `/api/groups/${id}`),
  groupPreview: (code: string) => request<{ name: string; tag: string; description: string; members: number; max: number }>('GET', `/api/public/group/${code}`),
  createGroup: (g: { name: string; tag: string; description: string }) => request<{ id: number }>('POST', '/api/groups', g),
  joinGroup: (code: string) => request<{ id: number; already?: boolean }>('POST', '/api/groups/join', { code }),
  editGroup: (id: number, patch: Partial<{ name: string; tag: string; description: string; newCode: boolean }>) => request<{ ok: true }>('PATCH', `/api/groups/${id}`, patch),
  showTag: (id: number, showTag: boolean) => request<{ ok: true }>('PUT', `/api/groups/${id}/me`, { showTag }),
  removeMember: (id: number, uid: number) => request<{ ok: true }>('DELETE', `/api/groups/${id}/members/${uid}`),
  setRole: (id: number, uid: number, role: 'mod' | 'member') => request<{ ok: true }>('PUT', `/api/groups/${id}/members/${uid}/role`, { role }),
  deleteGroup: (id: number) => request<{ ok: true }>('DELETE', `/api/groups/${id}`),
  postInvite: (id: number, webhook: string) => request<{ ok: true }>('POST', `/api/groups/${id}/discord`, { webhook }),

  adminCodes: () => request<{ codes: Code[] }>('GET', '/api/admin/codes'),
  makeCodes: (o: { days: number; validMinutes: number; maxUses: number; count: number; note: string }) => request<{ codes: string[] }>('POST', '/api/admin/codes', o),
  revokeCode: (code: string) => request<{ ok: true }>('DELETE', `/api/admin/codes/${code}`),
  adminPlans: () => request<{ plans: ({ userId: number } & Omit<Plan, 'limits' | 'owned' | 'joined' | 'proPaths'>)[]; openSignup: boolean }>('GET', '/api/admin/plans'),
  setPlan: (id: number, plan: 'free' | 'pro', days?: number) => request<{ ok: true }>('PUT', `/api/admin/users/${id}/plan`, { plan, days }),
  setOpenSignup: (open: boolean) => request<{ ok: true }>('PUT', '/api/admin/open-signup', { open }),
};
