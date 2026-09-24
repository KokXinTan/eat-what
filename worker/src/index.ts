// Eat What? Places proxy. The Google key lives only here (a Worker secret); the static site
// never sees it. Only listed origins are served, inputs are validated, each visitor is
// rate-limited, and searches need an access code (one per person, so you can revoke one).
// Photos can't carry a header, so each search returns a short-lived signed photo pass.
// Google's per-day quota caps are the final backstop.

import { Room, TRUSTED_CODE_HEADER } from './room';

export { Room };

interface DurableNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  GOOGLE_MAPS_API_KEY: string;
  /** Comma-separated access codes, e.g. "me-x7k2,aina-p9q3". Secret. */
  ACCESS_CODES: string;
  ALLOWED_ORIGINS: string;
  SEARCH_LIMITER: RateLimiter;
  PHOTO_LIMITER: RateLimiter;
  ROOM_LIMITER: RateLimiter;
  ROOMS: DurableNamespace;
}

const PLACES = 'https://places.googleapis.com/v1';
const MAX_RESULTS = 20;
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 10_000;
const MAX_QUERY_CHARS = 60;
const MIN_PHOTO_PX = 100;
const MAX_PHOTO_PX = 1600;
const PHOTO_PASS_SECONDS = 3600;
const CODE_HEADER = 'X-Access-Code';

/** Only the fields the app shows (fewer fields = cheaper Google SKU). */
export const FIELD_MASK = [
  'id',
  'displayName',
  'types',
  'primaryTypeDisplayName',
  'rating',
  'userRatingCount',
  'priceLevel',
  'priceRange',
  'location',
  'shortFormattedAddress',
  'addressComponents',
  'googleMapsUri',
  'regularOpeningHours',
  'utcOffsetMinutes',
  'businessStatus',
  'servesVegetarianFood',
  'servesBreakfast',
  'servesBrunch',
  'servesLunch',
  'servesDinner',
  'servesDessert',
  'servesCoffee',
  'dineIn',
  'takeout',
  'delivery',
  'goodForGroups',
  'goodForChildren',
  'outdoorSeating',
  'reservable',
  'editorialSummary',
  'generativeSummary',
  'reviewSummary',
  'photos',
  'reviews',
]
  .map((f) => `places.${f}`)
  .join(',');

export interface SearchInput {
  lat: number;
  lng: number;
  radius: number;
  query: string | null;
}

/** Validates the JSON body of /search. Returns an error message or the clean input. */
export function parseSearch(body: unknown): SearchInput | string {
  if (typeof body !== 'object' || body === null) return 'Body must be JSON.';
  const b = body as Record<string, unknown>;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const radius = Number(b.radius);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Bad lat.';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Bad lng.';
  if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) return 'Bad radius.';
  let query: string | null = null;
  if (b.query !== undefined && b.query !== null) {
    if (typeof b.query !== 'string' || !b.query.trim() || b.query.length > MAX_QUERY_CHARS) return 'Bad query.';
    query = b.query.trim();
  }
  return { lat, lng, radius: Math.round(radius), query };
}

/** Google request body for a nearby (or diet-keyword) restaurant search. */
export function googleSearchBody(s: SearchInput) {
  const circle = { center: { latitude: s.lat, longitude: s.lng }, radius: s.radius };
  return s.query
    ? { url: `${PLACES}/places:searchText`, body: { textQuery: s.query, maxResultCount: MAX_RESULTS, locationBias: { circle } } }
    : { url: `${PLACES}/places:searchNearby`, body: { includedTypes: ['restaurant', 'food_court'], maxResultCount: MAX_RESULTS, locationRestriction: { circle } } };
}

const MAX_REVIEWS = 3;
const MAX_PHOTOS = 5;
const AREA_TYPES = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality'];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Drops what the app never shows (full review lists, long address parts) — ~10x smaller. */
export function slimPlace(p: Json): Json {
  return {
    ...p,
    reviews: (p.reviews ?? []).slice(0, MAX_REVIEWS).map((r: Json) => ({
      text: { text: r.text?.text ?? '' },
      authorAttribution: { displayName: r.authorAttribution?.displayName },
    })),
    photos: (p.photos ?? []).slice(0, MAX_PHOTOS).map((ph: Json) => ({
      name: ph.name,
      authorAttributions: (ph.authorAttributions ?? []).slice(0, 1).map((a: Json) => ({ displayName: a.displayName, uri: a.uri })),
    })),
    addressComponents: (p.addressComponents ?? []).filter((c: Json) => (c.types ?? []).some((t: string) => AREA_TYPES.includes(t))),
    regularOpeningHours: p.regularOpeningHours ? { periods: p.regularOpeningHours.periods ?? [] } : undefined,
  };
}

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_ID_LENGTH = 6;
const ROOM_ID = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const ROOM_ACTIONS = ['join', 'state', 'vote', 'decide', 'leave'];
const CREATE_ATTEMPTS = 3;

/** Short, unambiguous room code like "K7XQ2M" (no 0/O, 1/I/L). */
export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

/** Swaps any photo pass inside stored place data for a fresh one (passes expire hourly). */
export function refreshPhotoPasses(body: string, pass: string): string {
  return body.replace(/pass=[A-Za-z0-9._%-]+/g, `pass=${encodeURIComponent(pass)}`);
}

const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export function parsePhoto(params: URLSearchParams): { name: string; width: number } | string {
  const name = params.get('name') ?? '';
  const width = Number(params.get('w') ?? 900);
  if (!PHOTO_NAME.test(name)) return 'Bad photo name.';
  if (!Number.isInteger(width) || width < MIN_PHOTO_PX || width > MAX_PHOTO_PX) return 'Bad width.';
  return { name, width };
}

/** Browsers send Origin on fetch() and (usually) a Referer on <img>; either must be allowed. */
export function allowedOrigin(req: Request, allowed: string[]): string | null {
  const origin = req.headers.get('Origin');
  if (origin) return allowed.includes(origin) ? origin : null;
  const referer = req.headers.get('Referer');
  if (!referer) return null;
  try {
    const o = new URL(referer).origin;
    return allowed.includes(o) ? o : null;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (avoids leaking codes through timing). */
export function sameText(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function validCode(code: string | null, codes: string): boolean {
  if (!code) return false;
  return codes
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((ok, c) => sameText(c, code.trim()) || ok, false);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * "expiry.signature" — lets <img> requests prove a recent authorised search. The expiry is
 * rounded to the hour so the pass (and so every photo URL) stays identical between room refreshes;
 * otherwise phones would re-download every photo on each poll. Valid for 1–2 hours.
 */
export async function makePhotoPass(secret: string, nowSec: number): Promise<string> {
  const exp = (Math.floor(nowSec / PHOTO_PASS_SECONDS) + 2) * PHOTO_PASS_SECONDS;
  return `${exp}.${await hmac(secret, `photo:${exp}`)}`;
}

export async function checkPhotoPass(secret: string, pass: string | null, nowSec: number): Promise<boolean> {
  const [exp, sig] = (pass ?? '').split('.');
  if (!exp || !sig || !(Number(exp) > nowSec)) return false;
  return sameText(sig, await hmac(secret, `photo:${exp}`));
}

function json(data: unknown, status: number, origin: string | null, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      ...extra,
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const origin = allowedOrigin(req, allowed);

    if (req.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': `Content-Type, ${CODE_HEADER}`,
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    if (!origin) return json({ error: 'Not allowed.' }, 403, null);

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';

    // ---- Swipe together: /rooms (create) and /rooms/:id/:action ----
    if (url.pathname === '/rooms' || url.pathname.startsWith('/rooms/')) {
      if (!(await env.ROOM_LIMITER.limit({ key: ip })).success) return json({ error: 'Too many requests — slow down a little.' }, 429, origin);
      const [, , roomId, action] = url.pathname.split('/');
      const codeValid = validCode(req.headers.get(CODE_HEADER), env.ACCESS_CODES);
      const forward = async (id: string, act: string, body?: string) => {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
        // Build a fresh request so a client can't smuggle in the trusted header.
        const inner = new Request(`https://room/${act}${url.search}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', [TRUSTED_CODE_HEADER]: codeValid ? '1' : '0' },
          body,
        });
        return stub.fetch(inner);
      };
      if (!roomId && req.method === 'POST') {
        // Only people with an access code can start a session (it spends your Google quota).
        if (!codeValid) return json({ error: 'Starting a session needs an access code.' }, 401, origin);
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        for (let i = 0; i < CREATE_ATTEMPTS; i++) {
          const id = newRoomId();
          const res = await forward(id, 'create', JSON.stringify({ ...body, roomId: id }));
          if (res.status !== 409) return json(await res.json(), res.status, origin);
        }
        return json({ error: 'Could not create a room — try again.' }, 503, origin);
      }
      if (!roomId || !ROOM_ID.test(roomId) || !action || !ROOM_ACTIONS.includes(action)) return json({ error: 'Not found.' }, 404, origin);
      const isGet = action === 'state';
      if (isGet !== (req.method === 'GET')) return json({ error: 'Wrong method.' }, 405, origin);
      const res = await forward(roomId, action, isGet ? undefined : await req.text());
      let text = await res.text();
      if (action === 'state' && res.ok) text = refreshPhotoPasses(text, await makePhotoPass(env.GOOGLE_MAPS_API_KEY, Math.floor(Date.now() / 1000)));
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
      });
    }

    if (url.pathname === '/search' && req.method === 'POST') {
      // Rate limit first so wrong codes can't be brute-forced.
      if (!(await env.SEARCH_LIMITER.limit({ key: ip })).success) return json({ error: 'Too many searches — wait a minute.' }, 429, origin);
      if (!validCode(req.headers.get(CODE_HEADER), env.ACCESS_CODES)) return json({ error: 'Access code not recognised.' }, 401, origin);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Body must be JSON.' }, 400, origin);
      }
      const input = parseSearch(body);
      if (typeof input === 'string') return json({ error: input }, 400, origin);
      const g = googleSearchBody(input);
      const res = await fetch(g.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify(g.body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Pass Google's error message through (never the key), so problems are debuggable.
        return json({ error: (data as { error?: { message?: string } }).error?.message ?? 'Google search failed.' }, 502, origin);
      }
      const photoPass = await makePhotoPass(env.GOOGLE_MAPS_API_KEY, Math.floor(Date.now() / 1000));
      return json({ places: ((data.places as Json[]) ?? []).map(slimPlace), photoPass }, 200, origin);
    }

    if (url.pathname === '/photo' && req.method === 'GET') {
      if (!(await env.PHOTO_LIMITER.limit({ key: ip })).success) return json({ error: 'Too many photos — wait a minute.' }, 429, origin);
      const p = parsePhoto(url.searchParams);
      if (typeof p === 'string') return json({ error: p }, 400, origin);
      if (!(await checkPhotoPass(env.GOOGLE_MAPS_API_KEY, url.searchParams.get('pass'), Math.floor(Date.now() / 1000)))) {
        return json({ error: 'Photo pass expired — search again.' }, 401, origin);
      }
      const res = await fetch(`${PLACES}/${p.name}/media?maxWidthPx=${p.width}&skipHttpRedirect=true`, {
        headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY },
      });
      const data = (await res.json().catch(() => ({}))) as { photoUri?: string };
      if (!res.ok || !data.photoUri) return json({ error: 'Photo unavailable.' }, 502, origin);
      // The photoUri is a plain googleusercontent link — no key in it.
      return new Response(null, { status: 302, headers: { Location: data.photoUri, 'Cache-Control': 'private, max-age=600' } });
    }

    return json({ error: 'Not found.' }, 404, origin);
  },
};
