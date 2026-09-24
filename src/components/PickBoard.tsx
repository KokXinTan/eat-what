import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { distanceLabel, priceLabel, type Card } from '../lib/rank';
import type { DietId } from '../lib/types';
import { FoodArt } from './FoodArt';
import { CardDetails, Gallery } from './PlaceCard';
import { Button, Icon, PillSelect, Sheet } from './ui';

// The board: a photo-first grid where you tap what tempts you. Solo, taps build a shortlist;
// in a group, everyone's taps show live as coloured initials on each photo.

type Sort = 'best' | 'near' | 'rated';

const SORTS: { value: Sort; label: string; short: string }[] = [
  { value: 'best', label: 'Best match for you', short: 'Best match' },
  { value: 'near', label: 'Nearest first', short: 'Nearest' },
  { value: 'rated', label: 'Top rated', short: 'Top rated' },
];

const MAX_CUISINE_CHIPS = 8;
/** Start loading more places when the end of the grid is this close to the screen. */
const LOAD_MARGIN = '700px';
const GEM_MIN_RATING = 4.4;
const GEM_MIN_REVIEWS = 15;
const GEM_MAX_REVIEWS = 250;
const MAX_AVATARS = 4;

export const MEMBER_COLOURS = ['#C23B22', '#9C6F0F', '#4A5230', '#1F5E7A', '#7A2E5E', '#5A3E2B'];

export interface Wanter {
  id: string;
  initial: string;
  colour: string;
  name: string;
}

/** Filter, sort and scroll are kept for this page visit (survive a pick and "Keep looking"). */
const remembered: { cuisine: string; sort: Sort; scroll: number } = { cuisine: 'All', sort: 'best', scroll: 0 };

export function resetBoard() {
  remembered.cuisine = 'All';
  remembered.scroll = 0;
}

/** Short cuisine label for grouping, e.g. "Japanese Restaurant" → "Japanese". */
export function cuisineOf(c: Card): string {
  const label = c.r.food || c.r.typeLabel.replace(/\s*restaurant\s*$/i, '');
  return label && !/^restaurant$/i.test(label) ? label : 'Other';
}

/** Rating that trusts many reviews more than a few (same idea as the ranking). */
function trusted(c: Card): number {
  const { rating, ratingCount } = c.r;
  if (rating === null) return 0;
  return (rating * ratingCount + 3.8 * 20) / (ratingCount + 20);
}

export function facts(c: Card): string[] {
  const r = c.r;
  return [
    r.rating !== null ? `★ ${r.rating.toFixed(1)}` : null,
    distanceLabel(r.distanceM),
    r.priceText ?? (r.price !== null ? priceLabel(r.price) : null),
  ].filter((x): x is string => Boolean(x));
}

export function PickBoard({
  cards,
  diets,
  wanted,
  onToggle,
  wanters,
  pickedIds,
  loadingMore = false,
  canLoadMore = false,
  onLoadMore,
  locked = false,
}: {
  cards: Card[];
  diets: DietId[];
  /** Places I've tapped. */
  wanted: Set<string>;
  onToggle: (c: Card) => void;
  /** Group mode: who wants each place (by place id). */
  wanters?: Map<string, Wanter[]>;
  pickedIds?: Set<string>;
  loadingMore?: boolean;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  /** Group decided: taps are off. */
  locked?: boolean;
}) {
  const [cuisine, setCuisineState] = useState(() => remembered.cuisine);
  const [sort, setSortState] = useState<Sort>(() => remembered.sort);
  const setCuisine = (c: string) => setCuisineState((remembered.cuisine = c));
  const setSort = (s: Sort) => setSortState((remembered.sort = s));
  const [info, setInfo] = useState<Card | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const main = document.getElementById('main');
    if (main && remembered.scroll) main.scrollTop = remembered.scroll;
    const save = () => main && (remembered.scroll = main.scrollTop);
    main?.addEventListener('scroll', save, { passive: true });
    return () => main?.removeEventListener('scroll', save);
  }, []);

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

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || !onLoadMore) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && !loadingMore && onLoadMore(), { rootMargin: LOAD_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, loadingMore, shown.length]);

  return (
    <section class="board" aria-label="Places nearby — tap the ones that tempt you">
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
              <Tile
                card={c}
                mine={wanted.has(c.r.id)}
                wanters={wanters?.get(c.r.id) ?? []}
                picked={pickedIds?.has(c.r.id) ?? false}
                locked={locked}
                onToggle={() => onToggle(c)}
                onInfo={() => setInfo(c)}
              />
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinel} class="explore-more" aria-live="polite">
        {loadingMore ? (
          <span class="muted small">
            <span class="waiting-dot small-dot" aria-hidden="true" /> Finding more places…
          </span>
        ) : canLoadMore && onLoadMore ? (
          <Button variant="ghost" size="sm" icon="plus" onClick={onLoadMore}>
            Load more places
          </Button>
        ) : (
          shown.length > 0 && <span class="muted small">That's everything nearby for now.</span>
        )}
      </div>

      {info && (
        <Sheet
          open
          title={info.r.name}
          onClose={() => setInfo(null)}
          footer={
            <>
              <a class="btn btn-ghost" href={info.r.mapsUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="map" size={18} />
                <span>Google Maps</span>
              </a>
              {!locked && (
                <Button
                  variant={wanted.has(info.r.id) ? 'secondary' : 'primary'}
                  icon="heart"
                  onClick={() => {
                    onToggle(info);
                    setInfo(null);
                  }}
                >
                  {wanted.has(info.r.id) ? 'Remove from my picks' : 'I want this'}
                </Button>
              )}
            </>
          }
        >
          <div class="explore-detail">
            {info.r.photos.length > 0 ? <Gallery r={info.r} /> : <FoodArt kind={info.r.art} size={160} class="detail-art" />}
            <p class="details-sub">{[info.r.typeLabel, info.r.area].filter(Boolean).join(' · ')}</p>
            <ul class="meta">
              {facts(info).map((f) => (
                <li key={f}>{f}</li>
              ))}
              {info.r.openNow === true && <li class="open">Open {info.r.hoursToday ?? 'now'}</li>}
              {info.r.openNow === false && <li class="closed">Closed · {info.r.opensAt ?? 'hours unknown'}</li>}
            </ul>
            <CardDetails card={info} diets={diets} mapsLink={false} />
          </div>
        </Sheet>
      )}
    </section>
  );
}

function Tile({
  card,
  mine,
  wanters,
  picked,
  locked,
  onToggle,
  onInfo,
}: {
  card: Card;
  mine: boolean;
  wanters: Wanter[];
  picked: boolean;
  locked: boolean;
  onToggle: () => void;
  onInfo: () => void;
}) {
  const r = card.r;
  const photo = r.photos[0];
  const [failed, setFailed] = useState(false);
  const [pop, setPop] = useState(0);
  const gem = r.rating !== null && r.rating >= GEM_MIN_RATING && r.ratingCount >= GEM_MIN_REVIEWS && r.ratingCount < GEM_MAX_REVIEWS;
  const closed = r.openNow === false;
  const f = facts(card);
  const extra = wanters.length - MAX_AVATARS;
  return (
    <div class={`tile ${mine ? 'is-mine' : ''} ${closed ? 'is-closed' : ''} ${photo && !failed ? 'has-photo' : 'no-photo'}`}>
      <button
        type="button"
        class="tile-hit"
        aria-pressed={mine}
        disabled={locked}
        aria-label={`${mine ? 'Remove' : 'Want'} ${r.name}. ${[r.typeLabel, ...f].filter(Boolean).join(', ')}${closed ? `. Closed, ${r.opensAt ?? ''}` : ''}${wanters.length ? `. Wanted by ${wanters.map((w) => w.name).join(', ')}` : ''}`}
        onClick={() => {
          onToggle();
          setPop((p) => p + 1);
          navigator.vibrate?.(10);
        }}
      >
        <span class="tile-media">
          {photo && !failed ? (
            <img src={photo.url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
          ) : (
            <FoodArt kind={r.art} class="tile-art" />
          )}
        </span>
        <span class="tile-shade" aria-hidden="true" />
        <span class="tile-body">
          <strong class="tile-name">{r.name}</strong>
          <span class="tile-facts">{[cuisineOf(card) === 'Other' ? null : cuisineOf(card), ...f].filter(Boolean).join(' · ')}</span>
        </span>
        <span class="tile-badges" aria-hidden="true">
          {picked && <span class="badge badge-picked">✓ Been</span>}
          {gem && <span class="badge badge-gem">✦ Local gem</span>}
          {closed && <span class="badge badge-closed">{r.opensAt ? r.opensAt.replace(/^opens/, 'Opens') : 'Closed'}</span>}
        </span>
        <span key={pop} class={`tile-heart ${mine ? 'is-on' : ''} ${pop ? 'pop' : ''}`} aria-hidden="true">
          <Icon name="heart" size={18} />
        </span>
        {wanters.length > 0 && (
          <span class="avatars" aria-hidden="true">
            {wanters.slice(0, MAX_AVATARS).map((w) => (
              <span key={w.id} class="avatar" style={{ background: w.colour }} title={w.name}>
                {w.initial}
              </span>
            ))}
            {extra > 0 && <span class="avatar avatar-more">+{extra}</span>}
          </span>
        )}
      </button>
      <button type="button" class="tile-info" aria-label={`Details for ${r.name}`} onClick={onInfo}>
        <Icon name="info" size={16} />
      </button>
    </div>
  );
}
