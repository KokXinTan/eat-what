import { artFor, foodFor } from './art-map';
import type { Distance, PriceLevel, Restaurant } from './types';

// Two interchangeable restaurant sources:
//  • OpenStreetMap: free, no key, used by anyone. No ratings, prices or photos.
//  • Google Places, via our Cloudflare Worker (worker/), for people with an access code.
//    The Google key lives only in the Worker; this site never sees it.
// Every result links to Google Maps for reviews and directions.

/** Worker URL, set at build time. Empty = OpenStreetMap only. */
export const PROXY_URL: string = (import.meta.env.VITE_PLACES_PROXY_URL ?? '').replace(/\/$/, '');
const CODE_KEY = 'eat-what:access-code';

export function getAccessCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAccessCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code.trim());
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* private mode: code lasts for this page only */
  }
}

/**
 * A personal setup link (…/eat-what/#code=YOUR-CODE) checks the code with the Worker and, if
 * valid, saves it on this phone. The code is removed from the address bar either way.
 */
export async function takeCodeFromLink(): Promise<'ok' | 'invalid' | 'busy' | 'offline' | null> {
  const m = location.hash.match(/(?:^#|&)code=([A-Za-z0-9_-]{3,64})/);
  if (!m) return null;
  // Remove the code from the address bar straight away, whatever the result.
  const rest = location.hash.replace(/(?:^#|&)code=[A-Za-z0-9_-]+/, '').replace(/^&/, '');
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
  const result = await checkAccessCode(m[1]);
  if (result === 'ok') setAccessCode(m[1]);
  return result;
}

/** Google when a Worker is configured and this browser has an access code. */
export function currentSource(): 'google' | 'osm' {
  return PROXY_URL && getAccessCode() ? 'google' : 'osm';
}

/** Asks the Worker whether a code is valid (no Google call). */
export async function checkAccessCode(code: string): Promise<'ok' | 'invalid' | 'busy' | 'offline'> {
  if (!PROXY_URL) return 'offline';
  try {
    const res = await fetch(`${PROXY_URL}/check`, { method: 'POST', headers: { 'X-Access-Code': code.trim() } });
    return res.ok ? 'ok' : res.status === 429 ? 'busy' : 'invalid';
  } catch {
    return 'offline';
  }
}

/** Thrown when the Worker rejects the access code. */
export class AccessCodeError extends Error {}

export const RADIUS_M: Record<Distance, number> = { walk: 800, near: 2000, drive: 6000 };

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceM(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

export function mapsSearchUrl(name: string, at: LatLng, googlePlaceId?: string): string {
  const q = encodeURIComponent(name);
  return googlePlaceId
    ? `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${googlePlaceId}`
    : `https://www.google.com/maps/search/?api=1&query=${q}%20${at.lat.toFixed(5)}%2C${at.lng.toFixed(5)}`;
}

export function getLocation(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share your location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'denied' : 'Could not get your location.')),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  });
}

// ---------- OpenStreetMap ----------

// Public Overpass servers; the second is tried if the first is busy or down.
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const OSM_TIMEOUT_MS = 15_000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

interface OsmElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Turns one OSM element into a Restaurant, or null if it has no name/location. */
export function fromOsm(el: OsmElement, center: LatLng): Restaurant | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const name = tags.name ?? tags['name:en'];
  if (!name || lat === undefined || lng === undefined) return null;
  const cuisines = (tags.cuisine ?? '').split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean);
  const amenity = tags.amenity ?? 'restaurant';
  const types = [amenity, ...cuisines.map((c) => `${c.replace(/ /g, '_')}_restaurant`)];
  if (tags['diet:vegan'] === 'only' || tags['diet:vegan'] === 'yes') types.push('vegan_restaurant');
  if (tags['diet:vegetarian'] === 'only') types.push('vegetarian_restaurant');
  const veg = tags['diet:vegetarian'];
  const food = cuisines.length ? cap(cuisines[0]) : amenity === 'cafe' ? 'Café' : amenity === 'fast_food' ? 'Fast food' : amenity === 'food_court' ? 'Food court' : '';
  const halal = tags['diet:halal'] === 'yes' || tags['diet:halal'] === 'only';
  const typeLabel = food && !['Café', 'Fast food', 'Food court'].includes(food) ? `${food} restaurant` : food || 'Restaurant';
  return {
    id: `osm:${el.type}/${el.id}`,
    name,
    food,
    typeLabel,
    area: tags['addr:suburb'] ?? tags['addr:city'] ?? '',
    types,
    rating: null,
    ratingCount: 0,
    price: null,
    distanceM: distanceM(center, { lat, lng }),
    openNow: null,
    address: [tags['addr:street'], tags['addr:suburb'] ?? tags['addr:city']].filter(Boolean).join(', '),
    mapsUrl: mapsSearchUrl(name, { lat, lng }),
    vegetarian: veg === 'yes' || veg === 'only' ? true : veg === 'no' ? false : null,
    summary: [halal ? 'halal' : '', cuisines.join(' ')].filter(Boolean).join(' '),
    art: artFor(`${name} ${cuisines.join(' ')} ${amenity}`),
    photos: [],
    serves: cuisines.slice(1, 4).map(cap),
    features: [],
    chain: Boolean(tags.brand),
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function searchOsm(center: LatLng, radius: number): Promise<Restaurant[]> {
  const around = `around:${radius},${center.lat},${center.lng}`;
  const query = `[out:json][timeout:20];(nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"]["name"](${around}););out center 300;`;
  let busy = false;
  for (const url of OVERPASS_URLS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), OSM_TIMEOUT_MS);
    try {
      // Overpass answers 406 unless JSON is explicitly accepted.
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) {
        busy ||= res.status === 429 || res.status === 504;
        continue;
      }
      const json = (await res.json()) as { elements: OsmElement[] };
      return json.elements.map((e) => fromOsm(e, center)).filter((r): r is Restaurant => r !== null);
    } catch {
      busy = true;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(busy ? 'The free map service is busy — try again in a minute.' : 'Could not reach the map service. Check your connection.');
}

/** Finds a typed area ("SS2 Petaling Jaya") when location is off. Free, via OSM Nominatim. */
export async function geocode(place: string): Promise<LatLng | null> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=my&q=${encodeURIComponent(place)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const [hit] = (await res.json()) as { lat: string; lon: string }[];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

// ---------- Google Places (via the Worker) ----------

const PRICE: Record<string, PriceLevel> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const PHOTO_MAX_PX = 900;
const MAX_PHOTOS = 5;
const REVIEW_MAX_CHARS = 150;
const AREA_TYPES = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality'];
const SEARCH_TIMEOUT_MS = 15_000;

/** The subset of a Places API (New) REST place that we use. */
export interface GPlace {
  id: string;
  displayName?: { text: string };
  types?: string[];
  primaryTypeDisplayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  priceRange?: { startPrice?: { units?: string; currencyCode?: string }; endPrice?: { units?: string } };
  location?: { latitude: number; longitude: number };
  shortFormattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types: string[] }[];
  googleMapsUri?: string;
  regularOpeningHours?: { periods?: Period[]; weekdayDescriptions?: string[] };
  utcOffsetMinutes?: number;
  businessStatus?: string;
  servesVegetarianFood?: boolean;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  servesDessert?: boolean;
  servesCoffee?: boolean;
  dineIn?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  goodForGroups?: boolean;
  goodForChildren?: boolean;
  outdoorSeating?: boolean;
  reservable?: boolean;
  editorialSummary?: { text?: string };
  generativeSummary?: { overview?: { text?: string } };
  reviewSummary?: { text?: { text?: string } };
  photos?: { name: string; authorAttributions?: { displayName?: string; uri?: string }[] }[];
  reviews?: { text?: { text?: string }; authorAttribution?: { displayName?: string } }[];
}

/** First review that is short enough to read at a glance, trimmed to a sentence. */
function snippet(p: GPlace): Restaurant['review'] {
  for (const rv of p.reviews ?? []) {
    const text = (rv.text?.text ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 25) continue;
    const cut = text.length > REVIEW_MAX_CHARS ? `${text.slice(0, REVIEW_MAX_CHARS).replace(/[,.;!?]?\s+\S*$/, '')}…` : text;
    return { text: cut, author: rv.authorAttribution?.displayName ?? 'A Google reviewer' };
  }
  return undefined;
}

function priceText(p: GPlace): string | undefined {
  const from = p.priceRange?.startPrice?.units;
  if (from === undefined) return undefined;
  const code = p.priceRange?.startPrice?.currencyCode;
  const cur = !code || code === 'MYR' ? 'RM' : code;
  const to = p.priceRange?.endPrice?.units;
  return to !== undefined ? `${cur} ${from}–${to}` : `${cur} ${from}+`;
}

function areaOf(p: GPlace): string {
  for (const t of AREA_TYPES) {
    const hit = p.addressComponents?.find((c) => c.types.includes(t));
    if (hit?.longText) return hit.shortText ?? hit.longText;
  }
  return '';
}

/** Turns one Google place (REST shape) into a card-ready Restaurant. */
export function fromGoogle(p: GPlace, center: LatLng, photoUrl: (name: string) => string, now = new Date()): Restaurant | null {
  const name = p.displayName?.text;
  if (!name || !p.location || p.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const at = { lat: p.location.latitude, lng: p.location.longitude };
  const types = p.types ?? [];
  const typeLabel = p.primaryTypeDisplayName?.text ?? '';
  const status = openStatus(p.regularOpeningHours?.periods, p.utcOffsetMinutes, now);
  const summary = p.editorialSummary?.text || p.generativeSummary?.overview?.text || p.reviewSummary?.text?.text || '';
  return {
    id: `g:${p.id}`,
    name,
    food: foodFor(types, typeLabel),
    typeLabel,
    area: areaOf(p),
    types,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? 0,
    price: p.priceLevel ? PRICE[p.priceLevel] ?? null : null,
    priceText: priceText(p),
    distanceM: distanceM(center, at),
    openNow: status.open,
    closesInMin: status.minsLeft,
    hoursToday: status.until,
    address: p.shortFormattedAddress ?? '',
    mapsUrl: p.googleMapsUri ?? mapsSearchUrl(name, at, p.id),
    vegetarian: p.servesVegetarianFood ?? null,
    summary,
    art: artFor(`${name} ${types.join(' ')} ${typeLabel}`),
    photos: (p.photos ?? []).slice(0, MAX_PHOTOS).map((ph) => ({
      url: photoUrl(ph.name),
      credit: ph.authorAttributions?.[0]?.displayName ?? 'Google Maps user',
      creditUrl: ph.authorAttributions?.[0]?.uri,
    })),
    serves: [
      p.servesBreakfast && 'Breakfast',
      p.servesBrunch && 'Brunch',
      p.servesLunch && 'Lunch',
      p.servesDinner && 'Dinner',
      p.servesDessert && 'Dessert',
      p.servesCoffee && 'Coffee',
      p.servesVegetarianFood && 'Vegetarian options',
    ].filter((x): x is string => Boolean(x)),
    features: [
      p.dineIn && 'Dine-in',
      p.takeout && 'Takeaway',
      p.delivery && 'Delivery',
      p.goodForGroups && 'Good for groups',
      p.outdoorSeating && 'Outdoor seating',
      p.goodForChildren && 'Kid-friendly',
      p.reservable && 'Takes bookings',
    ].filter((x): x is string => Boolean(x)),
    review: snippet(p),
  };
}

export interface Period {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number } | null;
}

const WEEK_MIN = 7 * 24 * 60;

/**
 * Open right now, and until when, from Google's weekly opening periods and the place's UTC
 * offset. (Place.isOpen() is beta-only, so we compute it ourselves.)
 */
export function openStatus(periods: Period[] | undefined, utcOffsetMinutes: number | undefined, now = new Date()): { open: boolean | null; until?: string; minsLeft?: number } {
  if (!periods?.length || utcOffsetMinutes === undefined) return { open: null };
  if (periods.length === 1 && !periods[0].close) return { open: true, until: '24 hours' };
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const p of periods) {
    if (!p.close) continue;
    const start = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let end = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (end <= start) end += WEEK_MIN;
    const tt = t < start ? t + WEEK_MIN : t;
    if (tt >= start && tt < end) {
      const h = p.close.hour % 12 || 12;
      const m = p.close.minute ? `:${String(p.close.minute).padStart(2, '0')}` : '';
      return { open: true, until: `until ${h}${m} ${p.close.hour < 12 ? 'am' : 'pm'}`, minsLeft: end - tt };
    }
  }
  return { open: false };
}

async function searchGoogle(center: LatLng, radius: number, textQuery: string | null): Promise<Restaurant[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEARCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': getAccessCode() },
      body: JSON.stringify({ lat: center.lat, lng: center.lng, radius, query: textQuery }),
      signal: ctl.signal,
    });
  } catch {
    throw new Error('Could not reach Google Maps. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { places?: GPlace[]; photoPass?: string; error?: string };
  if (res.status === 401) throw new AccessCodeError(data.error ?? 'Access code not recognised.');
  if (!res.ok) throw new Error(res.status === 429 ? 'Lots of searches just now — wait a minute and try again.' : 'Google Maps search failed — try again.');
  const pass = encodeURIComponent(data.photoPass ?? '');
  const photoUrl = (name: string) => `${PROXY_URL}/photo?name=${encodeURIComponent(name)}&w=${PHOTO_MAX_PX}&pass=${pass}`;
  const now = new Date();
  return (data.places ?? []).map((p) => fromGoogle(p, center, photoUrl, now)).filter((r): r is Restaurant => r !== null);
}

// ---------- shared entry point with a short cache ----------

const CACHE_MS = 30 * 60_000;
const RETRY_DELAY_MS = 2500;
const CACHE_PREFIX = 'eat-what:places:';

// Google's terms restrict storing Places content, so Google results stay in memory for this
// page only; free OSM results may use sessionStorage (kinder to the shared Overpass server).
const memory = new Map<string, { at: number; list: Restaurant[] }>();

function readCache(key: string): Restaurant[] | null {
  if (currentSource() === 'google') {
    const hit = memory.get(key);
    return hit && Date.now() - hit.at < CACHE_MS ? hit.list : null;
  }
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) ?? 'null') as { at: number; list: Restaurant[] } | null;
    return hit && Date.now() - hit.at < CACHE_MS ? hit.list : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, list: Restaurant[]) {
  if (currentSource() === 'google') {
    memory.set(key, { at: Date.now(), list });
    return;
  }
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), list }));
  } catch {
    /* cache is optional */
  }
}

/** Reuses a search for the same ~100 m area, radius and diet for up to 30 minutes. */
export async function findRestaurants(center: LatLng, distance: Distance, textQuery: string | null): Promise<Restaurant[]> {
  const radius = RADIUS_M[distance];
  // OSM ignores the diet words, so they only split the cache for Google.
  const source = currentSource();
  const key = `${source}:${center.lat.toFixed(3)},${center.lng.toFixed(3)}:${radius}:${source === 'google' ? textQuery ?? '' : ''}`;
  const cached = readCache(key);
  if (cached) return cached;
  const search = source === 'google' ? () => searchGoogle(center, radius, textQuery) : () => searchOsm(center, radius);
  let found: Restaurant[];
  try {
    found = await search();
  } catch (err) {
    // The free/public servers are sometimes briefly busy: wait a moment and try once more.
    if (err instanceof AccessCodeError) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    found = await search();
  }
  const list = found.filter(
    (r) => r.distanceM <= radius * 1.2,
  );
  writeCache(key, list);
  return list;
}
