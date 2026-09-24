import { describe, expect, it } from 'vitest';
import { fits } from './diet';
import { buildDeck, effectiveConstraints } from './rank';
import { freshData } from './storage';
import type { AppData, Restaurant } from './types';

const NOW = new Date('2026-09-24T19:00:00+08:00');

function r(over: Partial<Restaurant> & { id: string; name: string }): Restaurant {
  return {
    food: '',
    typeLabel: 'Restaurant',
    area: '',
    types: ['restaurant'],
    rating: null,
    ratingCount: 0,
    price: null,
    distanceM: 800,
    openNow: null,
    address: '',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=x',
    vegetarian: null,
    summary: '',
    art: 'riceBowl',
    serves: [],
    features: [],
    photos: [],
    ...over,
  };
}

function data(over: Partial<AppData> = {}, prefs: Partial<AppData['prefs']> = {}): AppData {
  const d = freshData();
  return { ...d, ...over, prefs: { ...d.prefs, ...prefs } };
}

const ids = (list: Restaurant[], d: AppData, seed = 's') => buildDeck(list, d, seed, NOW).cards.map((c) => c.r.id);

describe('deck ranking', () => {
  it('is deterministic for the same seed', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => r({ id, name: id }));
    expect(ids(list, data(), 'x')).toEqual(ids(list, data(), 'x'));
  });

  it('removes places that are closed or over budget, and explains why', () => {
    const list = [
      r({ id: 'closed', name: 'Closed', openNow: false }),
      r({ id: 'pricey', name: 'Pricey', price: 3 }),
      r({ id: 'ok', name: 'OK', price: 1 }),
      r({ id: 'unknown', name: 'Unknown price' }),
    ];
    const deck = buildDeck(list, data({}, { budget: 2 }), 's', NOW);
    expect(deck.cards.map((c) => c.r.id).sort()).toEqual(['ok', 'unknown']);
    expect(deck.removed).toEqual(['1 closed right now', '1 over your budget']);
    expect(deck.cards.find((c) => c.r.id === 'unknown')!.headsUp.join()).toMatch(/No price info/);
  });

  it('favours well-reviewed, close places and says why', () => {
    const list = [
      r({ id: 'meh', name: 'Meh', rating: 3.4, ratingCount: 900, distanceM: 1800 }),
      r({ id: 'great', name: 'Great', rating: 4.7, ratingCount: 1200, distanceM: 300 }),
    ];
    for (const seed of ['1', '2', '3']) {
      const deck = buildDeck(list, data(), seed, NOW);
      expect(deck.cards[0].r.id).toBe('great');
      expect(deck.cards[0].reasons.join(' ')).toMatch(/★ 4.7 from 1,200 reviews/);
    }
  });

  it('pushes back places picked or skipped recently, and drops thumbs-down', () => {
    const list = [r({ id: 'a', name: 'A' }), r({ id: 'b', name: 'B' }), r({ id: 'c', name: 'C' })];
    const recent = new Date(NOW.getTime() - 3600e3).toISOString();
    const d = data({
      picks: [
        { id: 'p1', placeId: 'a', name: 'A', food: '', art: 'riceBowl', mapsUrl: 'https://www.google.com/maps', date: recent, verdict: null },
        { id: 'p2', placeId: 'c', name: 'C', food: '', art: 'riceBowl', mapsUrl: 'https://www.google.com/maps', date: recent, verdict: 'down' },
      ],
      skips: [],
    });
    for (const seed of ['1', '2', '3', '4']) {
      const order = ids(list, d, seed);
      expect(order).toEqual(['b', 'a']);
    }
  });

  it('brings back a thumbs-up favourite with a reason', () => {
    const old = new Date(NOW.getTime() - 20 * 86400e3).toISOString();
    const d = data({ picks: [{ id: 'p', placeId: 'fav', name: 'Fav', food: '', art: 'riceBowl', mapsUrl: 'https://www.google.com/maps', date: old, verdict: 'up' }] });
    const deck = buildDeck([r({ id: 'x', name: 'X' }), r({ id: 'fav', name: 'Fav' })], d, 's', NOW);
    expect(deck.cards[0].r.id).toBe('fav');
    expect(deck.cards[0].reasons.join(' ')).toMatch(/thumbs up/);
  });

  it('prefers a different kind of food from the last pick', () => {
    const last = new Date(NOW.getTime() - 20 * 3600e3).toISOString();
    const d = data({ picks: [{ id: 'p', placeId: 'z', name: 'Z', food: 'Ramen', art: 'noodleSoup', mapsUrl: 'https://www.google.com/maps', date: last, verdict: null }] });
    const list = [r({ id: 'ramen2', name: 'Other ramen', art: 'noodleSoup' }), r({ id: 'curry', name: 'Curry house', art: 'curry' })];
    for (const seed of ['1', '2', '3']) expect(ids(list, d, seed)[0]).toBe('curry');
  });
});

describe('diet rules', () => {
  it('excludes clear conflicts but never claims halal is verified', () => {
    const pork = r({ id: 'p', name: 'Ah Kow Bak Kut Teh' });
    const bar = r({ id: 'b', name: 'Tipsy', types: ['bar', 'restaurant'] });
    const mamak = r({ id: 'm', name: 'Restoran Nasi Kandar Pelita' });
    expect(fits(pork, ['halal']).status).toBe('conflict');
    expect(fits(bar, ['halal']).status).toBe('conflict');
    expect(fits(mamak, ['halal'])).toEqual({ status: 'unverified', notes: ['Mentions halal — look for the certificate'] });
  });

  it('uses Google\'s vegetarian flag, and treats vegan as unverified from it', () => {
    const veg = r({ id: 'v', name: 'Leafy', vegetarian: true });
    expect(fits(veg, ['vegetarian']).status).toBe('ok');
    expect(fits(veg, ['vegan']).status).toBe('unverified');
    expect(fits(r({ id: 's', name: 'Steaks', types: ['steak_house'] }), ['vegetarian']).status).toBe('conflict');
    expect(fits(r({ id: 'n', name: 'No veg', vegetarian: false }), ['vegetarian']).status).toBe('conflict');
  });

  it('drops diet conflicts from the deck', () => {
    const list = [r({ id: 'pork', name: 'Char Siu King' }), r({ id: 'ok', name: 'Nasi Lemak Corner' })];
    const deck = buildDeck(list, data({}, { diets: ['no-pork'] }), 's', NOW);
    expect(deck.cards.map((c) => c.r.id)).toEqual(['ok']);
    expect(deck.cards[0].diet.status).toBe('unverified');
    expect(deck.removed).toEqual(['1 clash with your diet']);
  });
});

describe('group', () => {
  it('combines everyone\'s diets and takes the tightest budget', () => {
    const d = data(
      { group: [{ id: 'g1', name: 'Aina', diets: ['halal'], budget: 1 }, { id: 'g2', name: '', diets: ['vegetarian'], budget: null }] },
      { diets: ['no-beef'], budget: 3 },
    );
    const c = effectiveConstraints(d);
    expect(c.diets.sort()).toEqual(['halal', 'no-beef', 'vegetarian']);
    expect(c.budget).toBe(1);
    expect(c.people).toBe(3);
  });

  it('excludes places that clash with any member', () => {
    const d = data({ group: [{ id: 'g1', name: 'Aina', diets: ['halal'], budget: null }] });
    const deck = buildDeck([r({ id: 'pork', name: 'Pork Noodle House' }), r({ id: 'ok', name: 'Roti place' })], d, 's', NOW);
    expect(deck.cards.map((c) => c.r.id)).toEqual(['ok']);
    expect(deck.removed).toEqual(["1 clash with someone's diet"]);
  });
});

describe('opening hours in ranking', () => {
  it('pushes a place that closes within 45 minutes down and warns', () => {
    const list = [
      r({ id: 'closing', name: 'Closing', openNow: true, closesInMin: 20, hoursToday: 'until 9:30 pm', rating: 4.7, ratingCount: 2000 }),
      r({ id: 'open', name: 'Open late', openNow: true, closesInMin: 300, hoursToday: 'until 2 am' }),
    ];
    for (const seed of ['1', '2', '3']) {
      const deck = buildDeck(list, data(), seed, NOW);
      expect(deck.cards[0].r.id).toBe('open');
      expect(deck.cards[1].headsUp[0]).toMatch(/Closes soon \(until 9:30 pm\)/);
    }
  });
});
