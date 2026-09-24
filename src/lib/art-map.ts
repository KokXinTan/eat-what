import type { ArtKind } from './types';

// Picks an illustration from a restaurant's name and Google place types.
// First match wins, so specific words come before general ones.
const RULES: [RegExp, ArtKind][] = [
  [/nasi lemak/i, 'nasiLemak'],
  [/roti|naan|prata|thosai|dosa|chapati|capati|mamak|nasi kandar/i, 'roti'],
  [/ramen|laksa|pho|soup|sup\b|bak kut teh|curry mee|wantan|wonton|pan mee|yong tau foo|noodle house|vietnamese/i, 'noodleSoup'],
  [/fried rice|nasi goreng|biryani|briyani/i, 'friedRice'],
  [/goreng|char kway|kway teow|hokkien mee|noodle|mee\b|udon|soba|maggi|thai/i, 'friedNoodles'],
  [/sushi|sashimi|japanese|bento|donburi|izakaya|dumpling|dim sum|korean/i, 'sushi'],
  [/curry|kari|dhal|rendang|masala|indian|banana leaf|middle.?eastern|turkish|lebanese|afghan/i, 'curry'],
  [/porridge|congee|bubur/i, 'porridge'],
  [/pasta|spaghetti|italian|pizza|mediterranean|french|spanish|greek/i, 'pasta'],
  [/burger|sandwich|fries|american|fast.?food|diner|mexican/i, 'burger'],
  [/satay|grill|bbq|barbecue|steak|ikan bakar|roast|seafood/i, 'grill'],
  [/cendol|dessert|cake|ice.?cream|pancake|waffle|kuih|bingsu/i, 'dessert'],
  [/toast|kopitiam|kedai kopi|bakery|breakfast|brunch|cafe|café|coffee/i, 'toast'],
  [/salad|vegetarian|vegan|poke/i, 'greens'],
  [/rice|nasi|chicken|chinese|economy|campur|asian|food.?court|hawker/i, 'riceBowl'],
];

export function artFor(text: string): ArtKind {
  const t = text.replace(/_/g, ' ');
  for (const [re, kind] of RULES) if (re.test(t)) return kind;
  return 'riceBowl';
}

// Google place types → an appetising headline.
const TYPE_FOOD: Record<string, string> = {
  ramen_restaurant: 'Ramen',
  sushi_restaurant: 'Sushi',
  japanese_restaurant: 'Japanese',
  chinese_restaurant: 'Chinese',
  korean_restaurant: 'Korean',
  thai_restaurant: 'Thai',
  vietnamese_restaurant: 'Vietnamese',
  indian_restaurant: 'Indian',
  indonesian_restaurant: 'Indonesian',
  italian_restaurant: 'Italian',
  pizza_restaurant: 'Pizza',
  hamburger_restaurant: 'Burgers',
  steak_house: 'Steak',
  barbecue_restaurant: 'Barbecue',
  seafood_restaurant: 'Seafood',
  vegetarian_restaurant: 'Vegetarian',
  vegan_restaurant: 'Vegan',
  mexican_restaurant: 'Mexican',
  middle_eastern_restaurant: 'Middle Eastern',
  turkish_restaurant: 'Turkish',
  mediterranean_restaurant: 'Mediterranean',
  french_restaurant: 'French',
  american_restaurant: 'American',
  breakfast_restaurant: 'Breakfast',
  brunch_restaurant: 'Brunch',
  cafe: 'Café',
  coffee_shop: 'Coffee & bites',
  bakery: 'Bakery',
  dessert_shop: 'Dessert',
  dessert_restaurant: 'Dessert',
  ice_cream_shop: 'Ice cream',
  fast_food_restaurant: 'Fast food',
  food_court: 'Food court',
  asian_restaurant: 'Asian',
};

/** Headline food word, from the most specific known type (or Google's own label). */
export function foodFor(types: string[], typeLabel = ''): string {
  for (const t of types) if (TYPE_FOOD[t]) return TYPE_FOOD[t];
  const label = typeLabel.replace(/\s*restaurant\s*$/i, '').trim();
  return /^(restaurant|food|point of interest|establishment)?$/i.test(label) ? '' : label;
}
