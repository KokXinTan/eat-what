import { DIET_IDS } from './diet';
import type { AppData, ArtKind, Budget, DietId, Distance, Person, Pick, Skip } from './types';

export const STORAGE_KEY = 'eat-what:v2';
const BACKUP_APP = 'eat-what';
const MAX_TEXT = 300;
const MAX_PICKS = 500;
const MAX_SKIPS = 300;
const MAX_GROUP = 7;
const ART_KINDS: ArtKind[] = ['noodleSoup', 'friedNoodles', 'nasiLemak', 'friedRice', 'riceBowl', 'curry', 'roti', 'toast', 'porridge', 'pasta', 'grill', 'burger', 'sushi', 'dessert', 'greens'];

export function freshData(): AppData {
  return { version: 2, prefs: { diets: [], budget: null, distance: 'near', sound: false, showClosed: false }, picks: [], skips: [], group: [] };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshData();
    const result = parseData(JSON.parse(raw));
    if (result.ok) return result.data;
    // Keep unreadable data aside instead of silently overwriting it.
    localStorage.setItem(`${STORAGE_KEY}:unreadable`, raw);
    return freshData();
  } catch {
    return freshData();
  }
}

/** Returns false when the browser refuses to store (private mode, quota). */
export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function makeBackup(data: AppData, now = new Date()): string {
  return JSON.stringify({ app: BACKUP_APP, exportedAt: now.toISOString(), data }, null, 2);
}

export type ParseResult = { ok: true; data: AppData } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON. Choose an Eat What? backup file." };
  }
  if (isObject(json) && 'app' in json) {
    if (json.app !== BACKUP_APP) return { ok: false, error: "This JSON file isn't an Eat What? backup." };
    return parseData(json.data);
  }
  return parseData(json);
}

class Invalid extends Error {}
function fail(message: string): never {
  throw new Invalid(message);
}

export function parseData(input: unknown): ParseResult {
  try {
    if (!isObject(input)) fail('The backup is missing its data.');
    if (input.version !== 2) fail(`Unsupported backup version: ${String(input.version)}.`);
    const picks = list(input.picks ?? [], 'picks').slice(0, MAX_PICKS).map(parsePick);
    const skips = list(input.skips ?? [], 'skips').slice(0, MAX_SKIPS).map(parseSkip);
    const group = list(input.group ?? [], 'group').slice(0, MAX_GROUP).map(parsePerson);
    return { ok: true, data: { version: 2, prefs: parsePrefs(input.prefs), picks, skips, group } };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

function parsePrefs(v: unknown): AppData['prefs'] {
  if (v === undefined) return freshData().prefs;
  if (!isObject(v)) fail('Settings are not an object.');
  const distance = v.distance ?? 'near';
  if (distance !== 'walk' && distance !== 'near' && distance !== 'drive') fail('Settings have an unknown distance.');
  return { diets: diets(v.diets ?? [], 'Settings'), budget: budget(v.budget ?? null, 'Settings'), distance: distance as Distance, sound: v.sound === true, showClosed: v.showClosed === true };
}

function parsePick(v: unknown, i: number): Pick {
  const at = `Pick #${i + 1}`;
  if (!isObject(v)) fail(`${at} is not an object.`);
  const verdict = v.verdict ?? null;
  if (verdict !== null && verdict !== 'up' && verdict !== 'down') fail(`${at} has an unknown verdict.`);
  const art = v.art ?? 'riceBowl';
  if (!ART_KINDS.includes(art as ArtKind)) fail(`${at} has an unknown illustration.`);
  const mapsUrl = str(v.mapsUrl, `${at} link`, true);
  if (!/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl)/.test(mapsUrl)) fail(`${at} link is not a Google Maps link.`);
  return {
    id: str(v.id, `${at} id`, true),
    placeId: str(v.placeId, `${at} place`, true),
    name: str(v.name, `${at} name`, true),
    food: str(v.food ?? '', `${at} food`),
    art: art as ArtKind,
    mapsUrl,
    date: date(v.date, `${at} date`),
    verdict,
  };
}

function parseSkip(v: unknown, i: number): Skip {
  if (!isObject(v)) fail(`Skip #${i + 1} is not an object.`);
  return { placeId: str(v.placeId, `Skip #${i + 1} place`, true), date: date(v.date, `Skip #${i + 1} date`) };
}

function parsePerson(v: unknown, i: number): Person {
  const at = `Group member #${i + 1}`;
  if (!isObject(v)) fail(`${at} is not an object.`);
  return { id: str(v.id, `${at} id`, true), name: str(v.name ?? '', `${at} name`), diets: diets(v.diets ?? [], at), budget: budget(v.budget ?? null, at) };
}

// ---------- small validators ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function list(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) fail(`The backup's ${label} must be a list.`);
  return v;
}

function str(v: unknown, label: string, required = false): string {
  if (typeof v !== 'string') fail(`${label} must be text.`);
  const t = v.trim();
  if (required && !t) fail(`${label} is empty.`);
  if (t.length > MAX_TEXT) fail(`${label} is too long.`);
  return t;
}

function diets(v: unknown, label: string): DietId[] {
  if (!Array.isArray(v)) fail(`${label} diets must be a list.`);
  const bad = v.find((d) => !DIET_IDS.includes(d as DietId));
  if (bad !== undefined) fail(`${label} has an unknown diet: "${String(bad)}".`);
  return [...new Set(v as DietId[])];
}

function budget(v: unknown, label: string): Budget {
  if (v === null) return null;
  if (v !== 1 && v !== 2 && v !== 3 && v !== 4) fail(`${label} budget must be 1–4 or empty.`);
  return v;
}

function date(v: unknown, label: string): string {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) fail(`${label} is not a valid date.`);
  return v;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
