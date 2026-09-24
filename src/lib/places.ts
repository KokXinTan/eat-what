/// <reference types="google.maps" />
import { artFor, foodFor } from './art-map';
import type { Distance, PriceLevel, Restaurant } from './types';

// Two interchangeable restaurant sources:
//  • OpenStreetMap (default): free, no key. No ratings or prices.
//  • Google Places: used only when VITE_GOOGLE_MAPS_API_KEY is set at build time.
// Every result links to Google Maps for reviews and directions.

export const GOOGLE_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
export const SOURCE: 'google' | 'osm' = GOOGLE_KEY ? 'google' : 'osm';

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

// ---------- Google Places (optional) ----------

let placesLib: Promise<google.maps.PlacesLibrary> | null = null;

function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  placesLib ??= new Promise<void>((resolve, reject) => {
    const cb = '__eatWhatMapsReady';
    (window as unknown as Record<string, () => void>)[cb] = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=weekly&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error('Could not load Google Maps.'));
    document.head.appendChild(s);
  }).then(() => google.maps.importLibrary('places') as Promise<google.maps.PlacesLibrary>);
  return placesLib;
}

const PRICE: Record<string, PriceLevel> = { INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4 };
const BASE_FIELDS = [
  'id',
  'displayName',
  'types',
  'primaryTypeDisplayName',
  'rating',
  'userRatingCount',
  'priceLevel',
  'location',
  'shortFormattedAddress',
  'googleMapsURI',
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
  'editorialSummary',
  'photos',
  'reviews',
];
// Newer fields; any this Maps version rejects are dropped automatically (see searchGoogle).
const EXTRA_FIELDS = [
  'addressComponents',
  'priceRange',
  'hasDineIn',
  'hasTakeout',
  'hasDelivery',
  'isGoodForGroups',
  'isGoodForChildren',
  'hasOutdoorSeating',
  'isReservable',
  'generativeSummary',
  'reviewSummary',
];
let fields = [...BASE_FIELDS, ...EXTRA_FIELDS];
const MAX_FIELD_RETRIES = EXTRA_FIELDS.length;

const PHOTO_MAX_PX = 900;
const MAX_PHOTOS = 5;
const REVIEW_MAX_CHARS = 150;
const AREA_TYPES = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality'];

/** First review that is short enough to read at a glance, trimmed to a sentence. */
function snippet(p: google.maps.places.Place): Restaurant['review'] {
  for (const rv of p.reviews ?? []) {
    const text = (rv.text ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 25) continue;
    const cut = text.length > REVIEW_MAX_CHARS ? `${text.slice(0, REVIEW_MAX_CHARS).replace(/[,.;!?]?\s+\S*$/, '')}…` : text;
    return { text: cut, author: rv.authorAttribution?.displayName ?? 'A Google reviewer' };
  }
  return undefined;
}

/** Text from fields that may be a string or { text } depending on API version. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return textOf(o.text ?? o.overview ?? '');
  }
  return '';
}

function priceText(json: Record<string, unknown>): string | undefined {
  const range = json.priceRange as { startPrice?: { units?: string | number; currencyCode?: string }; endPrice?: { units?: string | number } } | undefined;
  const from = range?.startPrice?.units;
  if (from === undefined) return undefined;
  const cur = range?.startPrice?.currencyCode === 'MYR' || !range?.startPrice?.currencyCode ? 'RM' : range.startPrice.currencyCode;
  const to = range?.endPrice?.units;
  return to !== undefined ? `${cur} ${from}–${to}` : `${cur} ${from}+`;
}

function areaOf(p: google.maps.places.Place): string {
  const comps = p.addressComponents ?? [];
  for (const t of AREA_TYPES) {
    const hit = comps.find((c) => c.types.includes(t));
    if (hit?.longText) return hit.shortText ?? hit.longText;
  }
  return '';
}

/** "Wednesday: 11:00 AM – 10:00 PM" → "11:00 AM – 10:00 PM" for today (Google lists Monday first). */
function hoursToday(p: google.maps.places.Place, now = new Date()): string | undefined {
  const days = p.regularOpeningHours?.weekdayDescriptions;
  if (!days?.length) return undefined;
  const line = days[(now.getDay() + 6) % 7] ?? '';
  const hours = line.replace(/^[^:]+:\s*/, '').trim();
  return hours || undefined;
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

async function runSearch(Place: typeof google.maps.places.Place, center: LatLng, radius: number, textQuery: string | null) {
  // Try the rich field list; if Google rejects a field in this version, drop it and retry.
  for (let attempt = 0; ; attempt++) {
    try {
      return textQuery
        ? await Place.searchByText({ textQuery, fields, locationBias: { center, radius }, maxResultCount: 20 })
        : await Place.searchNearby({ fields, locationRestriction: { center, radius }, includedTypes: ['restaurant', 'food_court'], maxResultCount: 20 });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      const bad = EXTRA_FIELDS.find((f) => fields.includes(f) && msg.includes(f));
      if (!bad || attempt >= MAX_FIELD_RETRIES) throw new Error('Google Maps search failed. Check the API key and that Places API (New) is enabled.');
      fields = fields.filter((f) => f !== bad);
    }
  }
}

async function searchGoogle(center: LatLng, radius: number, textQuery: string | null): Promise<Restaurant[]> {
  const { Place } = await loadPlaces();
  const { places } = await runSearch(Place, center, radius, textQuery);
  const usable = places.filter((p) => p.location && p.displayName && p.businessStatus !== 'CLOSED_PERMANENTLY');
  const now = new Date();
  return usable.map((p): Restaurant => {
    const status = openStatus(p.regularOpeningHours?.periods as Period[] | undefined, p.utcOffsetMinutes ?? undefined, now);
    const at = { lat: p.location!.lat(), lng: p.location!.lng() };
    const name = p.displayName!;
    const types = p.types ?? [];
    const typeLabel = p.primaryTypeDisplayName ?? '';
    const json = p.toJSON() as Record<string, unknown>;
    const summary = p.editorialSummary || textOf(json.generativeSummary) || textOf(json.reviewSummary);
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
      priceText: priceText(json),
      distanceM: distanceM(center, at),
      openNow: status.open,
      closesInMin: status.minsLeft,
      hoursToday: status.until ?? hoursToday(p),
      address: p.shortFormattedAddress ?? '',
      mapsUrl: p.googleMapsURI ?? mapsSearchUrl(name, at, p.id),
      vegetarian: p.servesVegetarianFood ?? null,
      summary,
      art: artFor(`${name} ${types.join(' ')} ${typeLabel}`),
      // getURI only builds links; each (billed) image loads only when shown.
      photos: (p.photos ?? []).slice(0, MAX_PHOTOS).map((ph) => ({
        url: ph.getURI({ maxWidth: PHOTO_MAX_PX }),
        credit: ph.authorAttributions[0]?.displayName ?? 'Google Maps user',
        creditUrl: ph.authorAttributions[0]?.uri ?? undefined,
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
        json.hasDineIn && 'Dine-in',
        json.hasTakeout && 'Takeaway',
        json.hasDelivery && 'Delivery',
        json.isGoodForGroups && 'Good for groups',
        json.hasOutdoorSeating && 'Outdoor seating',
        json.isGoodForChildren && 'Kid-friendly',
        json.isReservable && 'Takes bookings',
      ].filter((x): x is string => Boolean(x)),
      review: snippet(p),
    };
  });
}

// ---------- shared entry point with a short cache ----------

const CACHE_MS = 30 * 60_000;
const CACHE_PREFIX = 'eat-what:places:';

function readCache(key: string): Restaurant[] | null {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) ?? 'null') as { at: number; list: Restaurant[] } | null;
    return hit && Date.now() - hit.at < CACHE_MS ? hit.list : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, list: Restaurant[]) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), list }));
  } catch {
    /* cache is optional */
  }
}

/** Searches once per ~100 m area, radius and diet for 30 minutes (fewer API calls, kinder to free servers). */
export async function findRestaurants(center: LatLng, distance: Distance, textQuery: string | null): Promise<Restaurant[]> {
  const radius = RADIUS_M[distance];
  // OSM ignores the diet words, so they only split the cache for Google.
  const key = `${SOURCE}:${center.lat.toFixed(3)},${center.lng.toFixed(3)}:${radius}:${SOURCE === 'google' ? textQuery ?? '' : ''}`;
  const cached = readCache(key);
  if (cached) return cached;
  const list = (SOURCE === 'google' ? await searchGoogle(center, radius, textQuery) : await searchOsm(center, radius)).filter(
    (r) => r.distanceM <= radius * 1.2,
  );
  writeCache(key, list);
  return list;
}
