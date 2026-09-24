import type { DietId, Restaurant } from './types';

// Google Maps has no halal/pork attributes, so these rules only use what is
// clearly known: obvious words in a name/type, and Google's vegetarian flag.
// Anything else is "unverified" — never presented as safe.

export const DIETS: Record<DietId, { label: string }> = {
  halal: { label: 'Halal' },
  'no-pork': { label: 'No pork' },
  'no-beef': { label: 'No beef' },
  vegetarian: { label: 'Vegetarian' },
  vegan: { label: 'Vegan' },
};

export const DIET_IDS = Object.keys(DIETS) as DietId[];

const PORK = /\b(pork|char ?siu|siu ?yuk|siew ?yuk|bak ?kut ?teh|babi|bacon|lard|ham)\b/i;
const BEEF = /\b(beef|daging|wagyu|brisket)\b/i;
const MEAT = /\b(chicken|ayam|duck|bbq|barbecue|satay|seafood|fish|ikan|burger|steak|grill|kambing|mutton)\b/i;
const ALCOHOL_TYPES = ['bar', 'pub', 'wine_bar', 'night_club', 'brewery', 'cocktail_bar'];
const MEAT_TYPES = ['steak_house', 'barbecue_restaurant', 'seafood_restaurant', 'hamburger_restaurant'];
const HALAL_WORD = /\b(halal|mamak|nasi kandar|muslim)\b/i;

export type Fit = { status: 'ok' | 'unverified' | 'conflict'; notes: string[] };

function one(r: Restaurant, diet: DietId): Fit {
  const text = `${r.name} ${r.food} ${r.summary}`;
  const label = DIETS[diet].label;
  switch (diet) {
    case 'halal':
      if (PORK.test(text)) return { status: 'conflict', notes: ['Serves pork'] };
      if (r.types.some((t) => ALCOHOL_TYPES.includes(t))) return { status: 'conflict', notes: ['Listed as a bar'] };
      return {
        status: 'unverified',
        notes: [HALAL_WORD.test(text) ? 'Mentions halal — look for the certificate' : 'Halal unverified — look for a certificate'],
      };
    case 'no-pork':
      if (PORK.test(text)) return { status: 'conflict', notes: ['Serves pork'] };
      return { status: 'unverified', notes: ['No pork: unverified — ask the shop'] };
    case 'no-beef':
      if (BEEF.test(text) || r.types.includes('steak_house')) return { status: 'conflict', notes: ['Known for beef'] };
      return { status: 'unverified', notes: ['No beef: unverified — ask the shop'] };
    case 'vegetarian':
    case 'vegan':
      if (r.types.includes('vegan_restaurant') || (diet === 'vegetarian' && r.types.includes('vegetarian_restaurant'))) {
        return { status: 'ok', notes: [`Listed on Google as ${diet}`] };
      }
      if (r.vegetarian === false || PORK.test(text) || r.types.some((t) => MEAT_TYPES.includes(t))) {
        return { status: 'conflict', notes: ['No vegetarian options listed'] };
      }
      if (r.vegetarian === true) {
        return diet === 'vegan'
          ? { status: 'unverified', notes: ['Has vegetarian options — vegan unverified'] }
          : { status: 'ok', notes: ['Google lists vegetarian options'] };
      }
      return { status: 'unverified', notes: [MEAT.test(text) ? `${label}: meat-focused — check the menu` : `${label}: unverified — check the menu`] };
  }
}

/** Combined verdict for several diets: the worst one wins, notes are merged. */
export function fits(r: Restaurant, diets: DietId[]): Fit {
  const rank = { ok: 0, unverified: 1, conflict: 2 } as const;
  let out: Fit = { status: 'ok', notes: [] };
  for (const d of diets) {
    const f = one(r, d);
    out = { status: rank[f.status] > rank[out.status] ? f.status : out.status, notes: [...out.notes, ...f.notes] };
  }
  return out;
}

/** Search words that steer Google towards suitable places for these diets. */
export function dietQuery(diets: DietId[]): string | null {
  const veg = diets.includes('vegan') ? 'vegan' : diets.includes('vegetarian') ? 'vegetarian' : '';
  if (diets.includes('halal')) return veg ? `halal ${veg} food` : 'halal food';
  return veg ? `${veg} food` : null;
}
