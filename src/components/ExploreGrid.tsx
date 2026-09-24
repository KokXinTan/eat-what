import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { distanceLabel, priceLabel, type Card } from '../lib/rank';
import type { DietId } from '../lib/types';
import { FoodArt } from './FoodArt';
import { CardDetails, Gallery } from './SwipeCard';
import { Button, Icon, PillSelect, Sheet } from './ui';

type Sort = 'best' | 'near' | 'rated';

const SORTS: { value: Sort; label: string; short: string }[] = [
  { value: 'best', label: 'Best match for you', short: 'Best match' },
  { value: 'near', label: 'Nearest first', short: 'Nearest' },
  { value: 'rated', label: 'Top rated', short: 'Top rated' },
];

const MAX_CUISINE_CHIPS = 8;
/** Kept for this page visit only, so a fresh start begins at the top with everything shown. */
const remembered: { cuisine: string; sort: Sort; scroll: number } = { cuisine: 'All', sort: 'best', scroll: 0 };

export function resetExplore() {
  remembered.cuisine = 'All';
  remembered.scroll = 0;
}
/** Start loading more places when the list end is this close to the screen. */
const LOAD_MARGIN = '600px';
const GEM_MIN_RATING = 4.4;
const GEM_MAX_REVIEWS = 250;
const GEM_MIN_REVIEWS = 15;

/** Short cuisine label for grouping, e.g. "Japanese Restaurant" → "Japanese". */
export function cuisineOf(c: Card): string {
  const label = c.r.food || c.r.typeLabel.replace(/\s*restaurant\s*$/i, '');
  return label && !/^restaurant$/i.test(label) ? label : 'Other';
}

/** Rating that trusts many reviews more than a few (same idea as the deck's ranking). */
function trusted(c: Card): number {
  const { rating, ratingCount } = c.r;
  if (rating === null) return 0;
  return (rating * ratingCount + 3.8 * 20) / (ratingCount + 20);
}

export function ExploreGrid({
  cards,
  diets,
  pickedIds,
  loadingMore,
  canLoadMore,
  onLoadMore,
  onChoose,
}: {
  cards: Card[];
  diets: DietId[];
  pickedIds: Set<string>;
  loadingMore: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onChoose: (c: Card) => void;
}) {
  // Filter, sort and scroll survive going to a pick and back ("Keep exploring").
  const [cuisine, setCuisineState] = useState(() => remembered.cuisine);
  const [sort, setSortState] = useState<Sort>(() => remembered.sort);
  const setCuisine = (c: string) => setCuisineState((remembered.cuisine = c));
  const setSort = (s: Sort) => setSortState((remembered.sort = s));
  useEffect(() => {
    const main = document.getElementById('main');
    if (main && remembered.scroll) main.scrollTop = remembered.scroll;
    const save = () => main && (remembered.scroll = main.scrollTop);
    main?.addEventListener('scroll', save, { passive: true });
    return () => main?.removeEventListener('scroll', save);
  }, []);
  const [open, setOpen] = useState<Card | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Cuisine chips come from what's actually nearby, most common first.
  const cuisines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(cuisineOf(c), (counts.get(cuisineOf(c)) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([name]) => name !== 'Other')
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CUISINE_CHIPS);
  }, [cards]);

  const shown = useMemo(() => {
    const list = cuisine === 'All' ? [...cards] : cards.filter((c) => cuisineOf(c) === cuisine);
    const closedLast = (a: Card, b: Card) => Number(a.r.openNow === false) - Number(b.r.openNow === false);
    if (sort === 'near') list.sort((a, b) => closedLast(a, b) || a.r.distanceM - b.r.distanceM);
    if (sort === 'rated') list.sort((a, b) => closedLast(a, b) || trusted(b) - trusted(a));
    return list;
  }, [cards, cuisine, sort]);

  // Scrolling near the end quietly loads more places (same pages the deck uses).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && !loadingMore && onLoadMore(), { rootMargin: LOAD_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, loadingMore, shown.length]);

  return (
    <section class="explore" aria-label="Explore places nearby">
      {cuisines.length > 1 && (
        <div class="cuisine-row" role="group" aria-label="Cuisine">
          {[['All', cards.length] as const, ...cuisines].map(([name, n]) => (
            <button key={name} type="button" class={`chip chip-cuisine ${cuisine === name ? 'is-on' : ''}`} aria-pressed={cuisine === name} onClick={() => setCuisine(name)}>
              {name} <span class="chip-count">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div class="explore-bar">
        <span class="muted small">
          {shown.length} {shown.length === 1 ? 'place' : 'places'}
          {cuisine !== 'All' ? ` · ${cuisine}` : ''}
        </span>
        <PillSelect icon="sort" label="Sort" value={sort} onChange={setSort} options={SORTS} />
      </div>

      {shown.length === 0 ? (
        <p class="explore-empty">
          No {cuisine === 'All' ? '' : `${cuisine} `}places match your filters here.{' '}
          {cuisine !== 'All' && (
            <button type="button" class="link" onClick={() => setCuisine('All')}>
              Show all
            </button>
          )}
        </p>
      ) : (
        <ul class="tile-grid">
          {shown.map((c) => (
            <li key={c.r.id}>
              <Tile card={c} picked={pickedIds.has(c.r.id)} onOpen={() => setOpen(c)} />
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinel} class="explore-more" aria-live="polite">
        {loadingMore ? (
          <span class="muted small">
            <span class="waiting-dot small-dot" aria-hidden="true" /> Finding more places…
          </span>
        ) : canLoadMore ? (
          <Button variant="ghost" size="sm" icon="plus" onClick={onLoadMore}>
            Load more places
          </Button>
        ) : (
          shown.length > 0 && <span class="muted small">That's everything nearby for now.</span>
        )}
      </div>

      {open && (
        <Sheet
          open
          title={open.r.name}
          onClose={() => setOpen(null)}
          footer={
            <>
              <a class="btn btn-ghost" href={open.r.mapsUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="map" size={18} />
                <span>Google Maps</span>
              </a>
              <Button
                variant="primary"
                icon="check"
                onClick={() => {
                  const c = open;
                  setOpen(null);
                  onChoose(c);
                }}
              >
                Let's go here
              </Button>
            </>
          }
        >
          <div class="explore-detail">
            {open.r.photos.length > 0 ? <Gallery r={open.r} /> : <FoodArt kind={open.r.art} size={160} class="detail-art" />}
            <p class="details-sub">{[open.r.typeLabel, open.r.area].filter(Boolean).join(' · ')}</p>
            <ul class="meta">
              {open.r.rating !== null && (
                <li>
                  ★ {open.r.rating.toFixed(1)} <span class="muted">({open.r.ratingCount.toLocaleString('en-MY')})</span>
                </li>
              )}
              {open.r.priceText ? <li>{open.r.priceText}</li> : open.r.price !== null && <li>{priceLabel(open.r.price)}</li>}
              <li>
                <Icon name="pin" size={14} /> {distanceLabel(open.r.distanceM)}
              </li>
              {open.r.openNow === true && <li class="open">Open {open.r.hoursToday ?? 'now'}</li>}
              {open.r.openNow === false && <li class="closed">Closed · {open.r.opensAt ?? 'hours unknown'}</li>}
            </ul>
            <CardDetails card={open} diets={diets} mapsLink={false} />
          </div>
        </Sheet>
      )}
    </section>
  );
}

function Tile({ card, picked, onOpen }: { card: Card; picked: boolean; onOpen: () => void }) {
  const r = card.r;
  const photo = r.photos[0];
  const [failed, setFailed] = useState(false);
  const gem = r.rating !== null && r.rating >= GEM_MIN_RATING && r.ratingCount >= GEM_MIN_REVIEWS && r.ratingCount < GEM_MAX_REVIEWS;
  const closed = r.openNow === false;
  const facts = [
    r.rating !== null ? `★ ${r.rating.toFixed(1)}` : null,
    distanceLabel(r.distanceM),
    r.priceText ?? (r.price !== null ? priceLabel(r.price) : null),
  ].filter(Boolean);
  return (
    <button type="button" class={`tile ${closed ? 'is-closed' : ''}`} onClick={onOpen} aria-label={`${r.name}. ${[r.typeLabel, ...facts].filter(Boolean).join(', ')}${closed ? `. Closed, ${r.opensAt ?? ''}` : ''}`}>
      <span class="tile-media">
        {photo && !failed ? (
          <img src={photo.url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <FoodArt kind={r.art} class="tile-art" />
        )}
        <span class="tile-badges">
          {picked && <span class="badge badge-picked">✓ Picked</span>}
          {gem && <span class="badge badge-gem">✦ Local gem</span>}
        </span>
        {closed && <span class="badge badge-closed">{r.opensAt ? r.opensAt.replace(/^opens/, 'Opens') : 'Closed'}</span>}
      </span>
      <span class="tile-body">
        <strong class="tile-name">{r.name}</strong>
        <span class="tile-type">{cuisineOf(card) === 'Other' ? r.typeLabel || 'Restaurant' : cuisineOf(card)}</span>
        <span class="tile-facts">{facts.join(' · ')}</span>
      </span>
    </button>
  );
}
