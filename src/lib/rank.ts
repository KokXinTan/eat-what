// Deterministic ranking of nearby restaurants for the pick board.
// Hard filters remove what clearly doesn't fit; each remaining place gets
// scored "factors" whose top positive texts become the "why this, today".
// A small seeded jitter keeps equal-ish places from always coming out in the
// same order, while the same seed + data always gives the same deck.

import { fits, type Fit } from './diet';
import type { AppData, Budget, DietId, Pick, Restaurant } from './types';

export const WEIGHTS = {
  ratingPerStar: 2,
  popular: 1,
  hiddenGem: 1.8,
  closeBy: 1.5,
  openNow: 1,
  newToYou: 1,
  lovedBefore: 3,
  sameFoodAsLastPick: -2,
  pickedRecently: -4,
  skippedRecently: -3,
  priceUnknown: -0.3,
  unverifiedDiet: -0.5,
  snackOutsideTea: -1.5,
  closingSoon: -4,
  chain: -1,
  jitter: 2.5,
} as const;

const DAY_MS = 86_400_000;
const RECENT_PICK_DAYS = 3;
/** Skipped places sink for a few days, fading back gradually. */
const SKIP_MEMORY_DAYS = 5;
const POPULAR_REVIEWS = 300;
const GEM_MIN_RATING = 4.4;
const GEM_MIN_REVIEWS = 15;
const GEM_MAX_REVIEWS = 250;
const CLOSE_BY_M = 500;
/** Ratings pulled towards this with few reviews (Bayesian average). */
const PRIOR_RATING = 3.8;
const PRIOR_WEIGHT = 20;

export interface Card {
  r: Restaurant;
  score: number;
  reasons: string[];
  headsUp: string[];
  diet: Fit;
}

export interface Deck {
  cards: Card[];
  /** Why places were removed, e.g. "3 over budget". Empty when nothing was removed. */
  removed: string[];
}

interface Factor {
  points: number;
  text?: string;
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function priceLabel(p: number): string {
  return '$'.repeat(p);
}

export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const WALK_M_PER_MIN = 80;
/** Don't send people to a place that's about to close. */
const CLOSING_SOON_MIN = 45;
/** Cafés and dessert shops suit tea time, not a main meal. */
const SNACK_TYPES = ['cafe', 'coffee_shop', 'ice_cream_shop', 'dessert_shop', 'bakery', 'ice_cream_restaurant'];
const TEA_HOURS = [15, 17];
/** The meal Google's "serves" flags use for the current hour, if any. */
function mealNow(now: Date): string | null {
  const h = now.getHours();
  if (h >= 6 && h < 11) return 'Breakfast';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 18 && h < 22) return 'Dinner';
  return null;
}
const isSnack = (r: Restaurant) => r.art === 'dessert' || r.types.some((t) => SNACK_TYPES.includes(t));

function daysAgo(iso: string, now: Date) {
  return (now.getTime() - Date.parse(iso)) / DAY_MS;
}

/** The constraints for everyone eating: you plus any group members. */
export function effectiveConstraints(data: AppData): { diets: DietId[]; budget: Budget; people: number } {
  const members = data.group;
  const diets = [...new Set([...data.prefs.diets, ...members.flatMap((m) => m.diets)])];
  const budgets = [data.prefs.budget, ...members.map((m) => m.budget)].filter((b): b is NonNullable<Budget> => b !== null);
  return { diets, budget: budgets.length ? (Math.min(...budgets) as Budget) : null, people: members.length + 1 };
}

export function buildDeck(list: Restaurant[], data: AppData, seed: string, now: Date): Deck {
  const { diets, budget, people } = effectiveConstraints(data);
  const removed = new Map<string, number>();
  const drop = (why: string) => removed.set(why, (removed.get(why) ?? 0) + 1);
  const lastPick: Pick | undefined = [...data.picks].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  const cards: Card[] = [];

  for (const r of list) {
    if (r.openNow === false && !data.prefs.showClosed) {
      drop('closed right now');
      continue;
    }
    if (budget !== null && r.price !== null && r.price > budget) {
      drop(people > 1 ? "over someone's budget" : 'over your budget');
      continue;
    }
    const diet = fits(r, diets);
    if (diet.status === 'conflict') {
      drop(people > 1 ? "clash with someone's diet" : 'clash with your diet');
      continue;
    }
    const pastPicks = data.picks.filter((p) => p.placeId === r.id);
    if (pastPicks.some((p) => p.verdict === 'down')) {
      drop('you gave a thumbs down');
      continue;
    }

    const f: Factor[] = [];
    if (r.rating !== null) {
      const adjusted = (r.rating * r.ratingCount + PRIOR_RATING * PRIOR_WEIGHT) / (r.ratingCount + PRIOR_WEIGHT);
      f.push({
        points: (adjusted - PRIOR_RATING) * WEIGHTS.ratingPerStar,
        text: r.rating >= 4.3 && r.ratingCount >= 50 ? `★ ${r.rating.toFixed(1)} from ${r.ratingCount.toLocaleString('en-MY')} reviews — people love it.` : undefined,
      });
      if (r.ratingCount >= POPULAR_REVIEWS) f.push({ points: WEIGHTS.popular });
      // Well-rated but little-known: a local favourite the crowds haven't found.
      if (r.rating >= GEM_MIN_RATING && r.ratingCount >= GEM_MIN_REVIEWS && r.ratingCount < GEM_MAX_REVIEWS) {
        f.push({ points: WEIGHTS.hiddenGem, text: `A local favourite — ★ ${r.rating.toFixed(1)} from ${r.ratingCount} reviews, fewer crowds.` });
      }
    }
    if (r.distanceM <= CLOSE_BY_M) {
      f.push({ points: WEIGHTS.closeBy, text: `Just ${distanceLabel(r.distanceM)} away — about ${Math.max(1, Math.round(r.distanceM / WALK_M_PER_MIN))} min on foot.` });
    } else {
      f.push({ points: -r.distanceM / 4000 });
    }
    const closingSoon = r.closesInMin !== undefined && r.closesInMin < CLOSING_SOON_MIN;
    if (closingSoon) f.push({ points: WEIGHTS.closingSoon });
    else if (r.openNow === true) f.push({ points: WEIGHTS.openNow, text: r.hoursToday === '24 hours' ? 'Open 24 hours.' : r.hoursToday ? `Open now, ${r.hoursToday}.` : 'Open right now.' });
    const meal = mealNow(now);
    if (meal && r.serves.includes(meal)) f.push({ points: 0.5, text: `Serves ${meal.toLowerCase()} — right on time.` });
    if (people > 1 && r.features.includes('Good for groups')) f.push({ points: 1, text: `Google says it's good for groups.` });
    const hour = now.getHours();
    if (isSnack(r)) {
      if (hour >= TEA_HOURS[0] && hour < TEA_HOURS[1]) f.push({ points: 0.5, text: 'Perfect for tea time.' });
      else f.push({ points: WEIGHTS.snackOutsideTea });
    }
    if (r.chain) f.push({ points: WEIGHTS.chain });

    const loved = pastPicks.find((p) => p.verdict === 'up');
    const recent = pastPicks.find((p) => daysAgo(p.date, now) < RECENT_PICK_DAYS);
    if (loved) f.push({ points: WEIGHTS.lovedBefore, text: `You gave it a thumbs up last time.` });
    else if (!pastPicks.length) f.push({ points: WEIGHTS.newToYou, text: data.picks.length ? 'Somewhere new for you.' : undefined });
    if (recent) f.push({ points: WEIGHTS.pickedRecently, text: 'You picked this in the last few days.' });
    if (lastPick && lastPick.placeId !== r.id && r.art === lastPick.art && daysAgo(lastPick.date, now) < RECENT_PICK_DAYS) {
      f.push({ points: WEIGHTS.sameFoodAsLastPick });
    } else if (lastPick && r.art !== lastPick.art && daysAgo(lastPick.date, now) < RECENT_PICK_DAYS && lastPick.food) {
      f.push({ points: 0.5, text: `A change from ${lastPick.name} last time.` });
    }
    const skip = data.skips.find((s) => s.placeId === r.id && daysAgo(s.date, now) < SKIP_MEMORY_DAYS);
    if (skip) f.push({ points: WEIGHTS.skippedRecently * (1 - daysAgo(skip.date, now) / SKIP_MEMORY_DAYS) });
    if (budget !== null) {
      if (r.price === null) f.push({ points: WEIGHTS.priceUnknown });
      else f.push({ points: 0.3, text: people > 1 ? `${priceLabel(r.price)} — fits everyone's budget.` : `${priceLabel(r.price)} — inside your budget.` });
    }
    if (diet.status === 'ok' && diets.length) f.push({ points: 1, text: diet.notes[0] });
    if (diet.status === 'unverified') f.push({ points: WEIGHTS.unverifiedDiet });

    const score = f.reduce((s, x) => s + x.points, 0) + hash(`${seed}:${r.id}`) * WEIGHTS.jitter;
    const reasons = f
      .filter((x) => x.points > 0 && x.text)
      .sort((a, b) => b.points - a.points)
      .map((x) => x.text!)
      .slice(0, 3);
    const headsUp = [
      ...(r.openNow === false ? [`Closed now${r.opensAt ? ` — ${r.opensAt}` : ''}`] : []),
      ...(r.closesInMin !== undefined && r.closesInMin < CLOSING_SOON_MIN ? [`Closes soon (${r.hoursToday}) — hurry`] : []),
      ...(budget !== null && r.price === null ? ['No price info — check before you go'] : []),
      ...(diet.status === 'unverified' ? diet.notes : []),
    ];
    cards.push({ r, score, reasons: reasons.length ? reasons : [fallbackReason(r)], headsUp, diet });
  }

  // Open places always come first; closed ones (only shown with "Any time") follow, best first.
  cards.sort((a, b) => Number(a.r.openNow === false) - Number(b.r.openNow === false) || b.score - a.score);
  return { cards, removed: [...removed.entries()].map(([why, n]) => `${n} ${why}`) };
}

function fallbackReason(r: Restaurant): string {
  return r.distanceM < 1500 ? `Close by at ${distanceLabel(r.distanceM)} — easy win.` : `Worth the short trip: ${distanceLabel(r.distanceM)} away.`;
}
