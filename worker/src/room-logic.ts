// Pure logic for a "swipe together" room. The Durable Object only loads, calls these and saves,
// so the rules are easy to test: who may join, who may vote, and what each person may see.

export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_MEMBERS = 12;
export const MAX_PLACES = 25;
export const MAX_LIST_BYTES = 250_000;
const MAX_NAME = 24;
const DIETS = ['halal', 'no-pork', 'no-beef', 'vegetarian', 'vegan'];

export type Status = 'approved' | 'pending' | 'denied';
export type Vote = 'yes' | 'no';

export interface Member {
  id: string;
  token: string;
  name: string;
  diets: string[];
  status: Status;
  host: boolean;
  joinedAt: number;
}

export interface Place {
  id: string;
  name: string;
  [k: string]: unknown;
}

export interface RoomState {
  id: string;
  createdAt: number;
  expiresAt: number;
  list: Place[];
  members: Member[];
  /** placeId → memberId → vote */
  votes: Record<string, Record<string, Vote>>;
}

export class RoomError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
  return s || fallback;
}

export function cleanDiets(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && DIETS.includes(d)))] : [];
}

export function cleanList(v: unknown): Place[] {
  if (!Array.isArray(v) || !v.length) throw new RoomError('The room needs some places.', 400);
  if (JSON.stringify(v).length > MAX_LIST_BYTES) throw new RoomError('Too many places.', 413);
  const list = v.slice(0, MAX_PLACES).filter((p): p is Place => typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.name === 'string');
  if (!list.length) throw new RoomError('The room needs some places.', 400);
  return list;
}

export function createRoom(id: string, input: { name?: unknown; diets?: unknown; list?: unknown }, token: string, memberId: string, now: number): RoomState {
  return {
    id,
    createdAt: now,
    expiresAt: now + ROOM_TTL_MS,
    list: cleanList(input.list),
    members: [{ id: memberId, token, name: cleanName(input.name, 'Host'), diets: cleanDiets(input.diets), status: 'approved', host: true, joinedAt: now }],
    votes: {},
  };
}

/** People with a valid access code are let straight in; everyone else waits for the host. */
export function join(state: RoomState, input: { name?: unknown; diets?: unknown }, codeValid: boolean, token: string, memberId: string, now: number): Member {
  if (state.members.filter((m) => m.status !== 'denied').length >= MAX_MEMBERS) throw new RoomError('This room is full.', 409);
  const member: Member = {
    id: memberId,
    token,
    name: cleanName(input.name, `Friend ${state.members.length}`),
    diets: cleanDiets(input.diets),
    status: codeValid ? 'approved' : 'pending',
    host: false,
    joinedAt: now,
  };
  state.members.push(member);
  return member;
}

export function byToken(state: RoomState, token: unknown): Member {
  const m = typeof token === 'string' ? state.members.find((x) => x.token === token) : undefined;
  if (!m) throw new RoomError('Not a member of this room.', 403);
  return m;
}

/** Only the host can approve or deny people waiting to join. */
export function decide(state: RoomState, token: unknown, memberId: unknown, approve: unknown): Member {
  const host = byToken(state, token);
  if (!host.host) throw new RoomError('Only the host can let people in.', 403);
  const m = state.members.find((x) => x.id === memberId && !x.host);
  if (!m) throw new RoomError('No such person.', 404);
  m.status = approve === true ? 'approved' : 'denied';
  if (m.status === 'denied') for (const v of Object.values(state.votes)) delete v[m.id];
  return m;
}

export function vote(state: RoomState, token: unknown, placeId: unknown, v: unknown): void {
  const m = byToken(state, token);
  if (m.status !== 'approved') throw new RoomError('Waiting for the host to let you in.', 403);
  if (typeof placeId !== 'string' || !state.list.some((p) => p.id === placeId)) throw new RoomError('Unknown place.', 400);
  if (v !== 'yes' && v !== 'no') throw new RoomError('Vote yes or no.', 400);
  (state.votes[placeId] ??= {})[m.id] = v;
}

export function leave(state: RoomState, token: unknown): void {
  const m = byToken(state, token);
  if (m.host) return; // the host "leaves" by letting the room expire
  state.members = state.members.filter((x) => x.id !== m.id);
  for (const v of Object.values(state.votes)) delete v[m.id];
}

/** Places every approved member (2+) said yes to, in deck order. */
export function matches(state: RoomState): string[] {
  const approved = state.members.filter((m) => m.status === 'approved');
  if (approved.length < 2) return [];
  return state.list.filter((p) => approved.every((m) => state.votes[p.id]?.[m.id] === 'yes')).map((p) => p.id);
}

/** What one person may see. Pending/denied people see nothing about the room's places. */
export function view(state: RoomState, token: unknown) {
  const me = byToken(state, token);
  const host = state.members.find((m) => m.host)!;
  if (me.status !== 'approved') return { status: me.status, hostName: host.name, roomId: state.id };
  const approved = state.members.filter((m) => m.status === 'approved');
  return {
    status: 'approved' as const,
    roomId: state.id,
    hostName: host.name,
    expiresAt: state.expiresAt,
    you: { id: me.id, host: me.host },
    members: state.members
      .filter((m) => m.status === 'approved' || (me.host && m.status === 'pending'))
      .map((m) => ({ id: m.id, name: m.name, diets: m.diets, status: m.status, host: m.host })),
    list: state.list,
    tally: Object.fromEntries(
      state.list.map((p) => {
        const v = state.votes[p.id] ?? {};
        return [p.id, { yes: approved.filter((m) => v[m.id] === 'yes').map((m) => m.id), no: approved.filter((m) => v[m.id] === 'no').length }];
      }),
    ),
    myVotes: Object.fromEntries(Object.entries(state.votes).flatMap(([pid, v]) => (v[me.id] ? [[pid, v[me.id]]] : []))),
    matches: matches(state),
  };
}
