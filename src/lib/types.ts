// Core data model. Restaurants come from Google Places at runtime; only the
// user's own settings, picks and skips are stored (in localStorage).

export type DietId = 'halal' | 'no-pork' | 'no-beef' | 'vegetarian' | 'vegan';

export type ArtKind =
  | 'noodleSoup'
  | 'friedNoodles'
  | 'nasiLemak'
  | 'friedRice'
  | 'riceBowl'
  | 'curry'
  | 'roti'
  | 'toast'
  | 'porridge'
  | 'pasta'
  | 'grill'
  | 'burger'
  | 'sushi'
  | 'dessert'
  | 'greens';

/** 1 = $, 2 = $$, 3 = $$$, 4 = $$$$ (Google price levels). */
export type PriceLevel = 1 | 2 | 3 | 4;

/** Max price level; null = any. */
export type Budget = PriceLevel | null;

export type Distance = 'walk' | 'near' | 'drive';

export interface Restaurant {
  id: string;
  name: string;
  /** Short cuisine word, e.g. "Ramen". Empty when unknown. */
  food: string;
  /** Google's own label, e.g. "Malaysian restaurant" (or the OSM cuisine). */
  typeLabel: string;
  /** Neighbourhood, e.g. "SS2". */
  area: string;
  types: string[];
  rating: number | null;
  ratingCount: number;
  price: PriceLevel | null;
  distanceM: number;
  openNow: boolean | null;
  address: string;
  mapsUrl: string;
  /** Google's "serves vegetarian food" attribute, when known. */
  vegetarian: boolean | null;
  summary: string;
  art: ArtKind;
  /** The place's own Google Maps photos, with the credits Google requires. */
  photos: Photo[];
  /** What they serve, e.g. "Breakfast", "Dessert" (Google flags or OSM cuisine tags). */
  serves: string[];
  /** Dine-in, Takeaway, Delivery, Good for groups… (Google only). */
  features: string[];
  /** Today's hours, e.g. "until 10 pm" or "24 hours". */
  hoursToday?: string;
  /** Minutes until it closes, when open now. */
  closesInMin?: number;
  /** When it next opens, if closed now, e.g. "opens 11 am" or "opens Tue 5 pm". */
  opensAt?: string;
  /** Google's price range per person, e.g. "RM 20–40". */
  priceText?: string;
  /** A short review excerpt that usually names dishes (Google mode only). */
  review?: { text: string; author: string };
  /** Part of a big chain (OSM "brand" tag). */
  chain?: boolean;
}

export interface Photo {
  url: string;
  credit: string;
  creditUrl?: string;
}

export interface Pick {
  id: string;
  placeId: string;
  name: string;
  food: string;
  art: ArtKind;
  mapsUrl: string;
  /** ISO timestamp. */
  date: string;
  verdict: 'up' | 'down' | null;
}

export interface Skip {
  placeId: string;
  date: string;
}

export interface Person {
  id: string;
  name: string;
  diets: DietId[];
  budget: Budget;
}

export interface Prefs {
  diets: DietId[];
  budget: Budget;
  distance: Distance;
  sound: boolean;
  /** Include places that are closed right now (for exploring). */
  showClosed: boolean;
}

export interface AppData {
  version: 2;
  prefs: Prefs;
  picks: Pick[];
  skips: Skip[];
  /** Extra people when choosing as a group (you are always included). */
  group: Person[];
}
