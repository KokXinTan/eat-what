import { describe, expect, it } from 'vitest';
import worker, { allowedOrigin, checkPhotoPass, googleSearchBody, makePhotoPass, parsePhoto, parseSearch, validCode, type Env } from './index';

const SITE = 'https://kokxintan.github.io';

function env(): Env {
  return {
    GOOGLE_MAPS_API_KEY: 'test-key',
    ACCESS_CODES: 'me-x7k2, aina-p9q3',
    ALLOWED_ORIGINS: `${SITE},http://localhost:5173`,
    SEARCH_LIMITER: { limit: async () => ({ success: true }) },
    PHOTO_LIMITER: { limit: async () => ({ success: true }) },
  };
}

describe('input validation', () => {
  it('accepts a normal search and rejects junk', () => {
    expect(parseSearch({ lat: 3.1, lng: 101.6, radius: 2000 })).toEqual({ lat: 3.1, lng: 101.6, radius: 2000, query: null });
    expect(parseSearch({ lat: 3.1, lng: 101.6, radius: 2000, query: ' halal food ' })).toMatchObject({ query: 'halal food' });
    expect(parseSearch({ lat: 91, lng: 0, radius: 2000 })).toBe('Bad lat.');
    expect(parseSearch({ lat: 3, lng: 101, radius: 50_000 })).toBe('Bad radius.');
    expect(parseSearch({ lat: 3, lng: 101, radius: 800, query: 'x'.repeat(200) })).toBe('Bad query.');
    expect(parseSearch('nope')).toBe('Body must be JSON.');
  });

  it('builds nearby vs text searches', () => {
    expect(googleSearchBody({ lat: 1, lng: 2, radius: 800, query: null }).url).toMatch(/searchNearby$/);
    expect(googleSearchBody({ lat: 1, lng: 2, radius: 800, query: 'vegan food' }).url).toMatch(/searchText$/);
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
    expect(await checkPhotoPass('secret', pass, now + 4000)).toBe(false); // expired
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
