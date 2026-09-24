// Client for "pick together" rooms on the Worker. A session is just { roomId, token }, kept in
// localStorage so a reload doesn't kick you out.
import { getAccessCode, PROXY_URL } from './places';
import type { DietId, Restaurant } from './types';

const SESSION_KEY = 'eat-what:session';
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export interface Session {
  roomId: string;
  token: string;
}

export interface RoomMember {
  id: string;
  name: string;
  diets: DietId[];
  status: 'approved' | 'pending';
  host: boolean;
}

export type RoomView =
  | { status: 'pending' | 'denied'; roomId: string; hostName: string }
  | {
      status: 'approved';
      roomId: string;
      hostName: string;
      expiresAt: number;
      you: { id: string; host: boolean };
      members: RoomMember[];
      list: Restaurant[];
      tally: Record<string, { yes: string[]; no: number }>;
      myVotes: Record<string, 'yes' | 'no'>;
      matches: string[];
      /** When the host's countdown ends (server clock, ms), if started. */
      deadline: number | null;
      /** Server clock when this view was made, to correct for phone clock drift. */
      now: number;
      /** The winning place once the countdown has ended. */
      decided: string | null;
    };

export class RoomGone extends Error {}

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return s && ROOM_CODE.test(s.roomId) && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: session lasts for this page */
  }
}

export function inviteLink(roomId: string): string {
  return `${location.origin}${location.pathname}#join=${roomId}`;
}

/** Room code from a #join=XXXXXX link, if present. */
export function roomFromHash(): string | null {
  const m = location.hash.match(/join=([A-Za-z0-9]{6})/);
  const id = m?.[1].toUpperCase() ?? '';
  return ROOM_CODE.test(id) ? id : null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const code = getAccessCode();
  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Access-Code': code } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error('Connection problem — retrying…');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 404 || res.status === 403) throw new RoomGone(data.error ?? 'This session has ended.');
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export function createRoom(list: Restaurant[], name: string, diets: DietId[]) {
  return call<Session>('/rooms', { method: 'POST', body: JSON.stringify({ list, name, diets }) });
}

export function joinRoom(roomId: string, name: string, diets: DietId[]) {
  return call<{ token: string; status: 'approved' | 'pending' }>(`/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ name, diets }) });
}

export function roomState(s: Session) {
  return call<RoomView>(`/rooms/${s.roomId}/state?token=${encodeURIComponent(s.token)}`);
}

/** Tap to want a place ('yes'), or null to take the tap back. */
export function vote(s: Session, placeId: string, v: 'yes' | null) {
  return call(`/rooms/${s.roomId}/vote`, { method: 'POST', body: JSON.stringify({ token: s.token, placeId, vote: v }) });
}

/** Host only: start a countdown; when it ends, the most-wanted place wins. */
export function startTimer(s: Session, seconds: number) {
  return call(`/rooms/${s.roomId}/timer`, { method: 'POST', body: JSON.stringify({ token: s.token, seconds }) });
}

export function decide(s: Session, memberId: string, approve: boolean) {
  return call(`/rooms/${s.roomId}/decide`, { method: 'POST', body: JSON.stringify({ token: s.token, memberId, approve }) });
}

export function leaveRoom(s: Session) {
  return call(`/rooms/${s.roomId}/leave`, { method: 'POST', body: JSON.stringify({ token: s.token }) });
}
