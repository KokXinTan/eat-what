import { describe, expect, it } from 'vitest';
import { Room } from './room';
import worker, { allowedOrigin, checkPhotoPass, googleSearch, makePhotoPass, MAX_PAGE, parsePhoto, parseSearch, validCode, type Env } from './index';

const SITE = 'https://kokxintan.github.io';

/** In-memory stand-in for the Durable Object namespace. */
function fakeRooms() {
  const rooms = new Map<string, Room>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const key = String(id);
      if (!rooms.has(key)) {
        const data = new Map<string, unknown>();
        rooms.set(
          key,
          new Room({
            storage: {
              get: async <T,>(k: string) => data.get(k) as T | undefined,
              put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
              deleteAll: async () => data.clear(),
              setAlarm: async () => {},
            },
          }),
        );
      }
      const room = rooms.get(key)!;
      return { fetch: (r: Request) => room.fetch(r) };
    },
  };
}

function env(): Env {
  return {
    GOOGLE_MAPS_API_KEY: 'test-key',
    ACCESS_CODES: 'me-x7k2, aina-p9q3',
    ALLOWED_ORIGINS: `${SITE},http://localhost:5173`,
    SEARCH_LIMITER: { limit: async () => ({ success: true }) },
    PHOTO_LIMITER: { limit: async () => ({ success: true }) },
    ROOM_LIMITER: { limit: async () => ({ success: true }) },
    ROOMS: fakeRooms(),
  };
}

describe('input validation', () => {
  it('accepts a normal search and rejects junk', () => {
    expect(parseSearch({ lat: 3.1, lng: 101.6, radius: 2000 })).toEqual({ lat: 3.1, lng: 101.6, radius: 2000, query: null, page: 0 });
    expect(parseSearch({ lat: 3.1, lng: 101.6, radius: 2000, query: ' halal food ' })).toMatchObject({ query: 'halal food' });
    expect(parseSearch({ lat: 91, lng: 0, radius: 2000 })).toBe('Bad lat.');
    expect(parseSearch({ lat: 3, lng: 101, radius: 50_000 })).toBe('Bad radius.');
    expect(parseSearch({ lat: 3, lng: 101, radius: 800, query: 'x'.repeat(200) })).toBe('Bad query.');
    expect(parseSearch('nope')).toBe('Body must be JSON.');
  });

  it('builds nearby vs text searches', () => {
    const at = { lat: 1, lng: 2, radius: 800, query: null };
    expect(googleSearch({ ...at, page: 0 }).body).toMatchObject({ rankPreference: 'POPULARITY' });
    expect(googleSearch({ ...at, page: 1 }).body).toMatchObject({ rankPreference: 'DISTANCE' });
    expect(googleSearch({ ...at, page: 2 })).toMatchObject({ url: expect.stringMatching(/searchText$/), body: { textQuery: 'kopitiam' } });
    expect(googleSearch({ ...at, query: 'halal food', page: 3 }).body).toMatchObject({ textQuery: 'halal food hawker stall' });
    expect(parseSearch({ lat: 1, lng: 2, radius: 800, page: MAX_PAGE + 1 })).toBe('Bad page.');
  });

  it('only allows well-formed photo names (no path tricks)', () => {
    expect(parsePhoto(new URLSearchParams('name=places/ChIJabc/photos/AbC_d-1&w=900'))).toEqual({ name: 'places/ChIJabc/photos/AbC_d-1', width: 900 });
    expect(parsePhoto(new URLSearchParams('name=places/../../evil&w=900'))).toBe('Bad photo name.');
    expect(parsePhoto(new URLSearchParams('name=places/a/photos/b&w=99999'))).toBe('Bad width.');
  });
});

describe('who may use the proxy', () => {
  it('checks Origin, or the Referer for images', () => {
    const allowed = [SITE];
    expect(allowedOrigin(new Request('https://w/search', { headers: { Origin: SITE } }), allowed)).toBe(SITE);
    expect(allowedOrigin(new Request('https://w/search', { headers: { Origin: 'https://evil.example' } }), allowed)).toBeNull();
    expect(allowedOrigin(new Request('https://w/photo', { headers: { Referer: `${SITE}/eat-what/` } }), allowed)).toBe(SITE);
    expect(allowedOrigin(new Request('https://w/photo'), allowed)).toBeNull();
  });

  it('matches access codes exactly', () => {
    expect(validCode('aina-p9q3', 'me-x7k2, aina-p9q3')).toBe(true);
    expect(validCode('aina-p9q', 'me-x7k2, aina-p9q3')).toBe(false);
    expect(validCode('', 'me-x7k2')).toBe(false);
    expect(validCode(null, 'me-x7k2')).toBe(false);
    expect(validCode('anything', '')).toBe(false);
  });

  it('signs photo passes that expire and cannot be forged', async () => {
    const now = 1_800_000_000;
    const pass = await makePhotoPass('secret', now);
    expect(await checkPhotoPass('secret', pass, now + 60)).toBe(true);
    expect(await checkPhotoPass('secret', pass, now + 3 * 3600)).toBe(false); // expired
    // Stable within the hour, so photo URLs don't change between room refreshes.
    expect(await makePhotoPass('secret', now + 5)).toBe(pass);
    expect(await checkPhotoPass('other-secret', pass, now)).toBe(false);
    const [exp, sig] = pass.split('.');
    expect(await checkPhotoPass('secret', `${Number(exp) + 9999}.${sig}`, now)).toBe(false); // tampered expiry
  });
});

describe('request handling', () => {
  it('refuses other sites and missing codes before calling Google', async () => {
    const other = await worker.fetch(new Request('https://w/search', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), env());
    expect(other.status).toBe(403);
    const noCode = await worker.fetch(
      new Request('https://w/search', { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 3, lng: 101, radius: 800 }) }),
      env(),
    );
    expect(noCode.status).toBe(401);
    expect(noCode.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  it('rate-limits before checking the code', async () => {
    const e = { ...env(), SEARCH_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await worker.fetch(new Request('https://w/search', { method: 'POST', headers: { Origin: SITE, 'X-Access-Code': 'me-x7k2' }, body: '{}' }), e);
    expect(res.status).toBe(429);
  });

  it('rejects photos without a valid pass', async () => {
    const res = await worker.fetch(new Request('https://w/photo?name=places/a/photos/b&w=900&pass=1.x', { headers: { Referer: `${SITE}/` } }), env());
    expect(res.status).toBe(401);
  });
});

describe('response slimming', () => {
  it('keeps what the card needs and drops the bulk', async () => {
    const { slimPlace } = await import('./index');
    const place = {
      id: 'x',
      displayName: { text: 'Shop' },
      reviews: Array.from({ length: 5 }, (_, i) => ({ text: { text: `review ${i}` }, originalText: { text: 'long' }, authorAttribution: { displayName: `A${i}`, photoUri: 'u' }, publishTime: 't' })),
      photos: Array.from({ length: 10 }, (_, i) => ({ name: `places/x/photos/p${i}`, widthPx: 1, authorAttributions: [{ displayName: 'D', uri: 'U', photoUri: 'P' }] })),
      addressComponents: [
        { longText: 'SS 2', shortText: 'SS 2', types: ['sublocality_level_1'] },
        { longText: '47300', types: ['postal_code'] },
      ],
      regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 } }], weekdayDescriptions: ['Mon'] },
    };
    const s = slimPlace(place);
    expect(s.reviews).toHaveLength(3);
    expect(s.reviews[0]).toEqual({ text: { text: 'review 0' }, authorAttribution: { displayName: 'A0' } });
    expect(s.photos).toHaveLength(5);
    expect(s.photos[0]).toEqual({ name: 'places/x/photos/p0', authorAttributions: [{ displayName: 'D', uri: 'U' }] });
    expect(s.addressComponents).toHaveLength(1);
    expect(s.regularOpeningHours).toEqual({ periods: [{ open: { day: 1, hour: 9, minute: 0 } }] });
    expect(s.displayName).toEqual({ text: 'Shop' });
  });
});

describe('swipe together over HTTP', () => {
  const post = (e: Env, path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://w${path}`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), e);
  const get = (e: Env, path: string) => worker.fetch(new Request(`https://w${path}`, { headers: { Origin: SITE } }), e);
  const LIST = [{ id: 'g:a', name: 'A', photos: [{ url: 'https://proxy/photo?name=places%2Fa%2Fphotos%2Fp&w=900&pass=OLD.sig' }] }, { id: 'g:b', name: 'B' }];

  it('needs an access code to start a session', async () => {
    const e = env();
    expect((await post(e, '/rooms', { list: LIST })).status).toBe(401);
    const res = await post(e, '/rooms', { name: 'Kok', list: LIST }, { 'X-Access-Code': 'me-x7k2' });
    expect(res.status).toBe(200);
    const { roomId, token } = (await res.json()) as { roomId: string; token: string };
    expect(roomId).toMatch(/^[A-Z2-9]{6}$/);
    expect(token).toBeTruthy();
  });

  it('code holders join instantly; others wait — and cannot fake approval', async () => {
    const e = env();
    const { roomId, token: host } = (await (await post(e, '/rooms', { name: 'Kok', list: LIST }, { 'X-Access-Code': 'me-x7k2' })).json()) as { roomId: string; token: string };
    const aina = (await (await post(e, `/rooms/${roomId}/join`, { name: 'Aina' }, { 'X-Access-Code': 'aina-p9q3' })).json()) as { status: string; token: string };
    expect(aina.status).toBe('approved');
    const sneaky = (await (await post(e, `/rooms/${roomId}/join`, { name: 'Ben' }, { 'X-Room-Code-Valid': '1' })).json()) as { status: string; token: string };
    expect(sneaky.status).toBe('pending');
    const benView = (await (await get(e, `/rooms/${roomId}/state?token=${sneaky.token}`)).json()) as Record<string, unknown>;
    expect(benView.list).toBeUndefined();
    const hostView = (await (await get(e, `/rooms/${roomId}/state?token=${host}`)).json()) as { members: { id: string; name: string; status: string }[] };
    const ben = hostView.members.find((m) => m.name === 'Ben')!;
    expect(ben.status).toBe('pending');
    expect((await post(e, `/rooms/${roomId}/decide`, { token: host, memberId: ben.id, approve: true })).status).toBe(200);
    const after = (await (await get(e, `/rooms/${roomId}/state?token=${sneaky.token}`)).json()) as { status: string };
    expect(after.status).toBe('approved');
  });

  it('refreshes photo passes when serving the room', async () => {
    const e = env();
    const { roomId, token } = (await (await post(e, '/rooms', { list: LIST }, { 'X-Access-Code': 'me-x7k2' })).json()) as { roomId: string; token: string };
    const view = await (await get(e, `/rooms/${roomId}/state?token=${token}`)).text();
    expect(view).not.toContain('pass=OLD.sig');
    expect(view).toMatch(/pass=\d+\.[A-Za-z0-9_-]+/);
  });

  it('404s unknown rooms and bad paths', async () => {
    const e = env();
    expect((await get(e, '/rooms/ZZZZZZ/state?token=x')).status).toBe(404);
    expect((await get(e, '/rooms/lower1/state?token=x')).status).toBe(404);
  });
});

describe('code check', () => {
  const check = (e: Env, code?: string) =>
    worker.fetch(new Request('https://w/check', { method: 'POST', headers: { Origin: SITE, ...(code ? { 'X-Access-Code': code } : {}) } }), e);
  it('confirms valid codes and rejects others', async () => {
    expect((await check(env(), 'aina-p9q3')).status).toBe(200);
    expect((await check(env(), 'random-guess')).status).toBe(401);
    expect((await check(env())).status).toBe(401);
    expect((await check({ ...env(), ACCESS_CODES: '' }, 'anything')).status).toBe(401);
  });
  it('is rate-limited', async () => {
    const e = { ...env(), SEARCH_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await check(e, 'aina-p9q3')).status).toBe(429);
  });
});
